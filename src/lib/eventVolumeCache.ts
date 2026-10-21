import type { Database } from "bun:sqlite";
import { eachUtcDate, type DayWindow } from "./volumeWindow";

export type VolumeSource = "amp" | "ai";

export type VolumeDailyRow = {
  source: VolumeSource;
  repo: string;
  eventName: string;
  day: string;
  count: number;
  fetchedAt: string;
};

export function markVolumeDaysFetched(
  db: Database,
  source: VolumeSource,
  days: string[],
  fetchedAt: string,
): void {
  const insert = db.prepare(
    `INSERT INTO event_volume_day (source, day, fetched_at)
     VALUES (?, ?, ?)
     ON CONFLICT(source, day) DO UPDATE SET fetched_at = excluded.fetched_at`,
  );
  for (const day of days) insert.run(source, day, fetchedAt);
}

export function missingVolumeDays(db: Database, source: VolumeSource, window: DayWindow): string[] {
  const fetched = new Set(
    (
      db
        .query("SELECT day FROM event_volume_day WHERE source = ? AND day >= ? AND day <= ?")
        .all(source, window.start, window.end) as Array<{ day: string }>
    ).map((row) => row.day),
  );
  return eachUtcDate(window).filter((day) => !fetched.has(day));
}

export function putVolumeDaily(db: Database, rows: VolumeDailyRow[]): void {
  const insert = db.prepare(
    `INSERT INTO event_volume_daily (source, repo, event_name, day, count, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(source, repo, event_name, day) DO UPDATE SET
       count = excluded.count,
       fetched_at = excluded.fetched_at`,
  );
  for (const row of rows) {
    insert.run(row.source, row.repo, row.eventName, row.day, row.count, row.fetchedAt);
  }
}

export type EventDayVolume = {
  date: string;
  amp: number;
  ai: number | null;
};

export function eventVolumeSeries(
  window: DayWindow,
  rows: Array<Pick<VolumeDailyRow, "source" | "day" | "count">>,
  hasAi: boolean,
): EventDayVolume[] {
  return eachUtcDate(window).map((date) => ({
    date,
    amp: rows.filter((row) => row.source === "amp" && row.day === date).reduce((sum, row) => sum + row.count, 0),
    ai: hasAi
      ? rows.filter((row) => row.source === "ai" && row.day === date).reduce((sum, row) => sum + row.count, 0)
      : null,
  }));
}

export function listEventVolumeDaily(
  db: Database,
  repo: string,
  eventName: string,
  window: DayWindow,
): VolumeDailyRow[] {
  const rows = db
    .query(
      `SELECT source, repo, event_name, day, count, fetched_at
       FROM event_volume_daily
       WHERE repo = ? AND event_name = ? AND day >= ? AND day <= ?
       ORDER BY source, day`,
    )
    .all(repo, eventName, window.start, window.end) as Array<{
    source: VolumeSource;
    repo: string;
    event_name: string;
    day: string;
    count: number;
    fetched_at: string;
  }>;
  return rows.map((row) => ({
    source: row.source,
    repo: row.repo,
    eventName: row.event_name,
    day: row.day,
    count: row.count,
    fetchedAt: row.fetched_at,
  }));
}

export function listRepoVolumeDaily(db: Database, repo: string, window: DayWindow): VolumeDailyRow[] {
  const rows = db
    .query(
      `SELECT source, repo, event_name, day, count, fetched_at
       FROM event_volume_daily
       WHERE repo = ? AND day >= ? AND day <= ?
       ORDER BY event_name, source, day`,
    )
    .all(repo, window.start, window.end) as Array<{
    source: VolumeSource;
    repo: string;
    event_name: string;
    day: string;
    count: number;
    fetched_at: string;
  }>;
  return rows.map((row) => ({
    source: row.source,
    repo: row.repo,
    eventName: row.event_name,
    day: row.day,
    count: row.count,
    fetchedAt: row.fetched_at,
  }));
}

export function listVolumeDaily(db: Database, window: DayWindow): VolumeDailyRow[] {
  const rows = db
    .query(
      `SELECT source, repo, event_name, day, count, fetched_at
       FROM event_volume_daily
       WHERE day >= ? AND day <= ?
       ORDER BY source, repo, event_name, day`,
    )
    .all(window.start, window.end) as Array<{
    source: VolumeSource;
    repo: string;
    event_name: string;
    day: string;
    count: number;
    fetched_at: string;
  }>;
  return rows.map((row) => ({
    source: row.source,
    repo: row.repo,
    eventName: row.event_name,
    day: row.day,
    count: row.count,
    fetchedAt: row.fetched_at,
  }));
}
