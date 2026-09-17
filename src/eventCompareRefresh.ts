import type { Database } from "bun:sqlite";
import {
  closedDayWindow,
  compareRowFromCache,
  contractFor,
  contractsForRepo,
  overlapVolume,
  ymdUtc,
  type CompareRow,
  type CompareSnapshot,
  type ContractField,
  type DailyVolume,
  type EventContract,
} from "./eventCompare";
import { getCompareCache, pendingSnapshot, putCompareCache } from "./eventCompareCache";
import {
  AI_STATEMENT_SESSION,
  executeStatement,
  type ExecuteDeps,
  type SnowflakeCreds,
} from "./snowflakeEvents";

export type RefreshDeps = Omit<ExecuteDeps, "now"> & { now?: () => Date };

function execDeps(deps?: RefreshDeps, session?: ExecuteDeps["session"]): ExecuteDeps {
  return { fetchImpl: deps?.fetchImpl, sleep: deps?.sleep, session };
}

function ampWhere(contract: EventContract, window: { start: string; end: string }): string {
  return `source_event_type = '${contract.ampEventType}'
  AND is_amplitude_generated_event = FALSE
  AND event_date BETWEEN '${window.start}' AND '${window.end}'
  AND environment IN ('${contract.ampEnvs.join("','")}')`;
}

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function aiWhere(contract: EventContract, window: { start: string; end: string }): string {
  const parts = [
    `${contract.aiDateExpr} BETWEEN '${window.start}' AND '${window.end}'`,
    `category = ${sqlString(contract.aiCategory)}`,
    `action = ${sqlString(contract.aiAction)}`,
    `environment IN ('${contract.aiEnvs.join("','")}')`,
  ];
  if (contract.aiEvent) {
    parts.push(`dimensions:event::VARCHAR = ${sqlString(contract.aiEvent)}`);
  }
  if (contract.aiEventExclude?.length) {
    parts.push(`dimensions:event::VARCHAR NOT IN (${contract.aiEventExclude.map(sqlString).join(",")})`);
    parts.push(`dimensions:event::VARCHAR NOT LIKE 'progressItem.%'`);
    parts.push(`dimensions:event::VARCHAR NOT LIKE 'notificationItem.%'`);
    parts.push(`dimensions:event::VARCHAR NOT LIKE 'createMenuItem.%'`);
  }
  return parts.join("\n  AND ");
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
  if (field.key === "event_time") {
    return `COUNT(${contractDateOrColumn(field.aiColumn)})`;
  }
  return `COUNT(${field.aiColumn})`;
}

function contractDateOrColumn(aiColumn: string): string {
  if (aiColumn === "dimensions:timestamp") {
    return "TRY_TO_TIMESTAMP(dimensions:timestamp::VARCHAR)";
  }
  return aiColumn;
}

export function ampVolumeSql(contract: EventContract, window: { start: string; end: string }): string {
  return `SELECT event_date::VARCHAR AS d, COUNT(*) AS event_count
FROM gold_prod.marts.fct_amplitude_events
WHERE ${ampWhere(contract, window)}
GROUP BY 1
ORDER BY 1`;
}

export function ampFillSql(contract: EventContract, window: { start: string; end: string }): string {
  const counts = contract.fields.map((f) => ampCountExpr(f)).join(", ");
  return `SELECT COUNT(*) AS n, ${counts}
FROM gold_prod.marts.fct_amplitude_events
WHERE ${ampWhere(contract, window)}`;
}

export function aiVolumeSql(contract: EventContract, window: { start: string; end: string }): string {
  return `SELECT ${contract.aiDateExpr}::VARCHAR AS d, COUNT(*) AS event_count
FROM ${contract.aiTable}
WHERE ${aiWhere(contract, window)}
GROUP BY 1
ORDER BY 1`;
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

function eachUtcDate(window: { start: string; end: string }): string[] {
  const out: string[] = [];
  const cursor = new Date(`${window.start}T00:00:00Z`);
  const last = new Date(`${window.end}T00:00:00Z`);
  while (cursor.getTime() <= last.getTime()) {
    out.push(ymdUtc(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

function dailyMap(rows: string[][]): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of rows) {
    const date = row[0] ?? "";
    if (!date) continue;
    map.set(date, parseCount(row[1]));
  }
  return map;
}

function mergeDaily(
  window: { start: string; end: string },
  ampRows: string[][],
  aiRows: string[][] | null,
): DailyVolume[] {
  const amp = dailyMap(ampRows);
  const ai = aiRows ? dailyMap(aiRows) : null;
  return eachUtcDate(window).map((date) => ({
    date,
    amp: amp.has(date) ? amp.get(date)! : null,
    ai: ai?.has(date) ? ai.get(date)! : null,
  }));
}

function sumPresent(daily: DailyVolume[], side: "ai" | "amp"): number {
  return daily.reduce((s, d) => s + (d[side] ?? 0), 0);
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
  const ampExec = execDeps(deps);
  const aiExec = execDeps(deps, AI_STATEMENT_SESSION);

  let snapshot = pendingSnapshot(contract, window);
  let lastError: string | null = null;
  let ampOk = false;
  let ampRows: string[][] = [];

  try {
    ampRows = await executeStatement(ampVolumeSql(contract, window), creds, ampExec);
    const fillRows = await executeStatement(ampFillSql(contract, window), creds, ampExec);
    snapshot.daily = mergeDaily(window, ampRows, null);
    snapshot.volume.amp = sumPresent(snapshot.daily, "amp");
    applyFills(snapshot, fillRows[0] ?? [], "ampFill");
    ampOk = true;
  } catch (err) {
    lastError = errorMessage(err);
    if (existing?.snapshot) {
      snapshot = existing.snapshot;
    }
  }

  if (ampOk) {
    try {
      const aiRows = await executeStatement(aiVolumeSql(contract, window), creds, aiExec);
      const fillRows = await executeStatement(aiFillSql(contract, window), creds, aiExec);
      snapshot.daily = mergeDaily(window, ampRows, aiRows);
      const overlap = overlapVolume(snapshot.daily);
      if (overlap) {
        snapshot.volume.ai = overlap.ai;
        snapshot.volume.amp = overlap.amp;
      } else {
        snapshot.volume.ai = null;
      }
      applyFills(snapshot, fillRows[0] ?? [], "aiFill");
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
  for (const c of contractsForRepo(repo)) {
    rows.push(await refreshEventCompare(repo, c.eventName, db, creds, deps));
  }
  return rows;
}
