import type { Database } from "bun:sqlite";
import type { EventAnalysis } from "./eventAnalysis";
import type { DayWindow } from "./volumeWindow";

export function putEventAnalysis(
  db: Database,
  repo: string,
  eventName: string,
  analysis: EventAnalysis,
  fetchedAt: string,
): void {
  db.run(
    `INSERT INTO event_analysis (repo, event_name, day, result_json, fetched_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(repo, event_name, day) DO UPDATE SET
       result_json = excluded.result_json,
       fetched_at = excluded.fetched_at`,
    [repo, eventName, analysis.day, JSON.stringify(analysis), fetchedAt],
  );
}

export function findEventAnalysis(
  db: Database,
  repo: string,
  eventName: string,
  window: DayWindow,
): EventAnalysis | null {
  const row = db
    .query(
      `SELECT result_json
       FROM event_analysis
       WHERE repo = ? AND event_name = ? AND day >= ? AND day <= ?
       ORDER BY day DESC
       LIMIT 1`,
    )
    .get(repo, eventName, window.start, window.end) as { result_json: string } | null;
  if (!row) return null;
  return JSON.parse(row.result_json) as EventAnalysis;
}

export async function loadCachedEventAnalysis(
  db: Database,
  repo: string,
  eventName: string,
  window: DayWindow,
  load: () => Promise<EventAnalysis>,
  now: () => string = () => new Date().toISOString(),
): Promise<EventAnalysis> {
  const cached = findEventAnalysis(db, repo, eventName, window);
  if (cached) return cached;
  const analysis = await load();
  putEventAnalysis(db, repo, eventName, analysis, now());
  return analysis;
}
