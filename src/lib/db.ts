import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Database } from "bun:sqlite";

export const DEFAULT_SQLITE_PATH = "./data/app.sqlite";

export function sqlitePathFromEnv(
  env: { SQLITE_PATH?: string } = process.env,
): string {
  return env.SQLITE_PATH ?? DEFAULT_SQLITE_PATH;
}

export function shouldCreateParentDir(sqlitePath: string): boolean {
  return dirname(sqlitePath) !== "/data";
}

export function openAppDatabase(sqlitePath: string): Database {
  if (shouldCreateParentDir(sqlitePath)) {
    mkdirSync(dirname(sqlitePath), { recursive: true });
  }
  const db = new Database(sqlitePath, { create: true });
  db.run("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)");
  db.run(`CREATE TABLE IF NOT EXISTS event_compare (
    repo TEXT NOT NULL,
    event_name TEXT NOT NULL,
    snapshot_json TEXT NOT NULL,
    refreshed_at TEXT,
    last_error TEXT,
    PRIMARY KEY (repo, event_name)
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS event_volume_daily (
    source TEXT NOT NULL,
    repo TEXT NOT NULL,
    event_name TEXT NOT NULL,
    day TEXT NOT NULL,
    count INTEGER NOT NULL,
    fetched_at TEXT NOT NULL,
    PRIMARY KEY (source, repo, event_name, day)
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS event_volume_day (
    source TEXT NOT NULL,
    day TEXT NOT NULL,
    fetched_at TEXT NOT NULL,
    PRIMARY KEY (source, day)
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS event_analysis (
    repo TEXT NOT NULL,
    event_name TEXT NOT NULL,
    day TEXT NOT NULL,
    result_json TEXT NOT NULL,
    fetched_at TEXT NOT NULL,
    PRIMARY KEY (repo, event_name, day)
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS event_examples (
    repo TEXT NOT NULL,
    event_name TEXT NOT NULL,
    day TEXT NOT NULL,
    paired INTEGER NOT NULL,
    amp_json TEXT,
    ai_json TEXT,
    fetched_at TEXT NOT NULL,
    PRIMARY KEY (repo, event_name, day)
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS repo_contributor (
    repo TEXT NOT NULL,
    rank INTEGER NOT NULL,
    login TEXT NOT NULL,
    name TEXT NOT NULL,
    contributions INTEGER NOT NULL,
    fetched_at TEXT NOT NULL,
    PRIMARY KEY (repo, rank)
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS homepage_refresh_job (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    status TEXT NOT NULL,
    window_start TEXT,
    window_end TEXT,
    completed INTEGER NOT NULL,
    total INTEGER NOT NULL,
    message TEXT NOT NULL,
    error TEXT,
    started_at TEXT,
    updated_at TEXT,
    finished_at TEXT
  )`);
  return db;
}
