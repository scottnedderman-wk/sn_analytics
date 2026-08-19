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
  return db;
}
