import type { Database } from "bun:sqlite";
import {
  closedDayWindow,
  compareRowFromCache,
  contractFor,
  contractsForRepo,
  type CompareRow,
  type CompareSnapshot,
  type ContractField,
  type EventContract,
} from "./eventCompare";
import { getCompareCache, pendingSnapshot, putCompareCache } from "./eventCompareCache";
import {
  executeStatement,
  type ExecuteDeps,
  type SnowflakeCreds,
} from "./snowflakeEvents";

export type RefreshDeps = Omit<ExecuteDeps, "now"> & { now?: () => Date };

function execDeps(deps?: RefreshDeps): ExecuteDeps {
  return { fetchImpl: deps?.fetchImpl, sleep: deps?.sleep };
}

function ampWhere(contract: EventContract, window: { start: string; end: string }): string {
  return `source_event_type = '${contract.ampEventType}'
  AND is_amplitude_generated_event = FALSE
  AND event_date BETWEEN '${window.start}' AND '${window.end}'
  AND environment IN ('${contract.ampEnvs.join("','")}')`;
}

function aiWhere(contract: EventContract, window: { start: string; end: string }): string {
  return `analytic_date BETWEEN '${window.start}' AND '${window.end}'
  AND environment IN ('${contract.aiEnvs.join("','")}')`;
}

function ampCountExpr(field: ContractField): string {
  if (field.key === "duration") {
    return "COUNT(TRY_TO_DOUBLE(raw_event_properties:value::STRING))";
  }
  return `COUNT(${field.ampColumn})`;
}

function aiCountExpr(field: ContractField): string {
  if (field.key === "duration") {
    return "COUNT(value)";
  }
  return `COUNT(${field.aiColumn})`;
}

export function ampVolumeSql(contract: EventContract, window: { start: string; end: string }): string {
  return `SELECT COUNT(*) AS event_count
FROM gold_prod.marts.fct_amplitude_events
WHERE ${ampWhere(contract, window)}`;
}

export function ampFillSql(contract: EventContract, window: { start: string; end: string }): string {
  const counts = contract.fields.map((f) => ampCountExpr(f)).join(", ");
  return `SELECT COUNT(*) AS n, ${counts}
FROM gold_prod.marts.fct_amplitude_events
WHERE ${ampWhere(contract, window)}`;
}

export function aiVolumeSql(contract: EventContract, window: { start: string; end: string }): string {
  return `SELECT COUNT(*) AS event_count
FROM ${contract.aiTable}
WHERE ${aiWhere(contract, window)}`;
}

export function aiFillSql(contract: EventContract, window: { start: string; end: string }): string {
  const counts = contract.fields.map((f) => aiCountExpr(f)).join(", ");
  return `SELECT COUNT(*) AS n, ${counts}
FROM ${contract.aiTable}
WHERE ${aiWhere(contract, window)}`;
}

function parseCount(cell: string | undefined): number {
  return Number.parseFloat(cell ?? "0") || 0;
}

function applyFills(
  snapshot: CompareSnapshot,
  row: string[],
  side: "ampFill" | "aiFill",
): void {
  const n = parseCount(row[0]);
  for (let i = 0; i < snapshot.fields.length; i++) {
    const count = parseCount(row[i + 1]);
    snapshot.fields[i]![side] = n > 0 ? count / n : 0;
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function refreshEventCompare(
  repo: string,
  eventName: string,
  db: Database,
  creds: SnowflakeCreds,
  deps?: RefreshDeps,
): Promise<CompareRow> {
  const contract = contractFor(eventName);
  if (!contract) throw new Error(`No compare contract for ${eventName}`);
  if (contract.repo !== repo) throw new Error(`${eventName} does not belong to ${repo}`);

  const clock = deps?.now ?? (() => new Date());
  const now = clock();
  const window = closedDayWindow(now);
  const existing = getCompareCache(db, repo, eventName);
  const exec = execDeps(deps);

  let snapshot = pendingSnapshot(contract, window);
  let lastError: string | null = null;
  let ampOk = false;

  try {
    const volRows = await executeStatement(ampVolumeSql(contract, window), creds, exec);
    const fillRows = await executeStatement(ampFillSql(contract, window), creds, exec);
    snapshot.volume.amp = parseCount(volRows[0]?.[0]);
    const fillRow = fillRows[0] ?? [];
    applyFills(snapshot, fillRow, "ampFill");
    ampOk = true;
  } catch (err) {
    lastError = errorMessage(err);
    if (existing?.snapshot) {
      snapshot = existing.snapshot;
    }
  }

  if (ampOk) {
    try {
      const volRows = await executeStatement(aiVolumeSql(contract, window), creds, exec);
      const fillRows = await executeStatement(aiFillSql(contract, window), creds, exec);
      snapshot.volume.ai = parseCount(volRows[0]?.[0]);
      const fillRow = fillRows[0] ?? [];
      applyFills(snapshot, fillRow, "aiFill");
    } catch (err) {
      lastError = errorMessage(err);
    }
  }

  const refreshedAt = ampOk
    ? now.toISOString()
    : (existing?.refreshedAt ?? null);

  putCompareCache(db, {
    repo,
    eventName,
    snapshot,
    refreshedAt,
    lastError,
  });

  return compareRowFromCache(eventName, snapshot, refreshedAt, lastError);
}

export async function refreshRepoCompares(
  repo: string,
  db: Database,
  creds: SnowflakeCreds,
  deps?: RefreshDeps,
): Promise<CompareRow[]> {
  const rows: CompareRow[] = [];
  for (const contract of contractsForRepo(repo)) {
    rows.push(await refreshEventCompare(repo, contract.eventName, db, creds, deps));
  }
  return rows;
}
