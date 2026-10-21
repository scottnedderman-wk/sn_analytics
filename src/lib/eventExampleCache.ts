import type { Database } from "bun:sqlite";
import type { EventSample, EventSampleSide } from "./eventSample";
import type { MigrationEvent } from "./model";
import type { DayWindow } from "./volumeWindow";

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function exampleDay(sample: EventSample, fallback: string): string {
  const stamp = sample.amp?.eventTime ?? sample.ai?.eventTime ?? "";
  const day = stamp.slice(0, 10);
  return DAY.test(day) ? day : fallback;
}

function sideJson(side: EventSampleSide | null): string | null {
  return side ? JSON.stringify(side) : null;
}

function parseSide(json: string | null): EventSampleSide | null | undefined {
  if (!json) return null;
  const side = JSON.parse(json) as Partial<EventSampleSide>;
  if (!side.properties || typeof side.properties !== "object" || Array.isArray(side.properties)) return undefined;
  return side as EventSampleSide;
}

export function putEventExample(
  db: Database,
  repo: string,
  eventName: string,
  day: string,
  sample: EventSample,
  fetchedAt: string,
): void {
  db.run(
    `INSERT INTO event_examples (repo, event_name, day, paired, amp_json, ai_json, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(repo, event_name, day) DO UPDATE SET
       paired = excluded.paired,
       amp_json = excluded.amp_json,
       ai_json = excluded.ai_json,
       fetched_at = excluded.fetched_at`,
    [repo, eventName, day, sample.paired ? 1 : 0, sideJson(sample.amp), sideJson(sample.ai), fetchedAt],
  );
}

export function findEventExample(
  db: Database,
  repo: string,
  eventName: string,
  window: DayWindow,
): EventSample | null {
  const row = db
    .query(
      `SELECT paired, amp_json, ai_json
       FROM event_examples
       WHERE repo = ? AND event_name = ? AND day >= ? AND day <= ?
       ORDER BY day DESC
       LIMIT 1`,
    )
    .get(repo, eventName, window.start, window.end) as
    | { paired: number; amp_json: string | null; ai_json: string | null }
    | null;
  if (!row) return null;
  const amp = parseSide(row.amp_json);
  const ai = parseSide(row.ai_json);
  if (amp === undefined || ai === undefined) return null;
  return { paired: row.paired === 1, amp, ai };
}

export async function loadCachedEventSample(
  db: Database,
  repo: string,
  event: MigrationEvent,
  window: DayWindow,
  load: () => Promise<EventSample>,
  now: () => string = () => new Date().toISOString(),
): Promise<EventSample> {
  const cached = findEventExample(db, repo, event.name, window);
  if (cached) return cached;
  const sample = await load();
  if (sample.amp || sample.ai) {
    putEventExample(db, repo, event.name, exampleDay(sample, window.end), sample, now());
  }
  return sample;
}
