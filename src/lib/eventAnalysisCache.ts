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

function analysisFromJson(json: string): EventAnalysis | null {
  try {
    const parsed = JSON.parse(json) as EventAnalysis;
    return Array.isArray(parsed.sections) ? parsed : null;
  } catch {
    return null;
  }
}

export function cachedAnalysisEventNames(db: Database, repo: string, window: DayWindow): string[] {
  const rows = db
    .query(
      `SELECT event_name, result_json
       FROM event_analysis
       WHERE repo = ? AND day >= ? AND day <= ?
       ORDER BY day DESC`,
    )
    .all(repo, window.start, window.end) as { event_name: string; result_json: string }[];
  const seen = new Set<string>();
  const names: string[] = [];
  for (const row of rows) {
    if (seen.has(row.event_name)) continue;
    seen.add(row.event_name);
    if (analysisFromJson(row.result_json)) names.push(row.event_name);
  }
  return names.sort((a, b) => a.localeCompare(b));
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
  return analysisFromJson(row.result_json);
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
  const started = Date.now();
  const analysis = await load();
  const recorded = { ...analysis, durationMs: Date.now() - started };
  putEventAnalysis(db, repo, eventName, recorded, now());
  return recorded;
}
