import type { Database } from "bun:sqlite";
import {
  type CompareSnapshot,
  type EventContract,
  type SnapshotField,
} from "./eventCompare";

export type CachedCompare = {
  repo: string;
  eventName: string;
  snapshot: CompareSnapshot | null;
  refreshedAt: string | null;
  lastError: string | null;
};

export function pendingSnapshot(contract: EventContract, window: { start: string; end: string }): CompareSnapshot {
  const fields: SnapshotField[] = contract.fields.map((f) => ({
    key: f.key,
    aiColumn: f.aiColumn,
    aiType: f.aiType,
    ampColumn: f.ampColumn,
    ampType: f.ampType,
    present: f.present,
    typeCompatible: f.typeCompatible,
    aiFill: null,
    ampFill: null,
  }));
  return { version: 1, window, volume: { ai: null, amp: null }, fields };
}

function parseSnapshot(json: string): CompareSnapshot | null {
  try {
    const v = JSON.parse(json) as CompareSnapshot;
    if (v?.version !== 1) return null;
    return v;
  } catch {
    return null;
  }
}

export function listCompareCache(db: Database, repo: string): CachedCompare[] {
  const rows = db
    .query(
      "SELECT repo, event_name, snapshot_json, refreshed_at, last_error FROM event_compare WHERE repo = ?",
    )
    .all(repo) as Array<{
    repo: string;
    event_name: string;
    snapshot_json: string;
    refreshed_at: string | null;
    last_error: string | null;
  }>;
  return rows.map((r) => ({
    repo: r.repo,
    eventName: r.event_name,
    snapshot: parseSnapshot(r.snapshot_json),
    refreshedAt: r.refreshed_at,
    lastError: r.last_error,
  }));
}

export function getCompareCache(db: Database, repo: string, eventName: string): CachedCompare | undefined {
  return listCompareCache(db, repo).find((r) => r.eventName === eventName);
}

export function putCompareCache(db: Database, row: CachedCompare): void {
  const snapshot = row.snapshot ?? { version: 1 as const, window: { start: "", end: "" }, volume: { ai: null, amp: null }, fields: [] };
  db.run(
    `INSERT INTO event_compare (repo, event_name, snapshot_json, refreshed_at, last_error)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(repo, event_name) DO UPDATE SET
       snapshot_json = excluded.snapshot_json,
       refreshed_at = excluded.refreshed_at,
       last_error = excluded.last_error`,
    [row.repo, row.eventName, JSON.stringify(snapshot), row.refreshedAt, row.lastError],
  );
}
