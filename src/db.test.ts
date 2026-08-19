import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_SQLITE_PATH,
  openAppDatabase,
  shouldCreateParentDir,
  sqlitePathFromEnv,
} from "./db";

test("sqlitePathFromEnv defaults to ./data/app.sqlite", () => {
  expect(sqlitePathFromEnv({})).toBe(DEFAULT_SQLITE_PATH);
});

test("sqlitePathFromEnv reads SQLITE_PATH", () => {
  expect(sqlitePathFromEnv({ SQLITE_PATH: "/data/app.sqlite" })).toBe(
    "/data/app.sqlite",
  );
});

test("shouldCreateParentDir is false only for /data", () => {
  expect(shouldCreateParentDir("/data/app.sqlite")).toBe(false);
  expect(shouldCreateParentDir("./data/app.sqlite")).toBe(true);
});

test("openAppDatabase creates file and meta table", () => {
  const dir = mkdtempSync(join(tmpdir(), "sn-analytics-"));
  const path = join(dir, "nested", "app.sqlite");
  const db = openAppDatabase(path);
  try {
    const rows = db
      .query("SELECT name FROM sqlite_master WHERE type='table' AND name='meta'")
      .all();
    expect(rows.length).toBe(1);
    expect(existsSync(path)).toBe(true);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
