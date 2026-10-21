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

test("openAppDatabase creates event_volume_daily and event_volume_day tables", () => {
  const dir = mkdtempSync(join(tmpdir(), "sn-analytics-"));
  const path = join(dir, "app.sqlite");
  const db = openAppDatabase(path);
  try {
    const names = db
      .query("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('event_volume_daily','event_volume_day')")
      .all() as Array<{ name: string }>;
    expect(names.map((row) => row.name).sort()).toEqual(["event_volume_daily", "event_volume_day"]);
    const jobs = db
      .query("SELECT name FROM sqlite_master WHERE type='table' AND name='homepage_refresh_job'")
      .all();
    expect(jobs.length).toBe(1);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("openAppDatabase creates event_compare table", () => {
  const dir = mkdtempSync(join(tmpdir(), "sn-analytics-"));
  const path = join(dir, "app.sqlite");
  const db = openAppDatabase(path);
  try {
    const rows = db
      .query("SELECT name FROM sqlite_master WHERE type='table' AND name='event_compare'")
      .all();
    expect(rows.length).toBe(1);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("openAppDatabase creates event_analysis table", () => {
  const dir = mkdtempSync(join(tmpdir(), "sn-analytics-"));
  const path = join(dir, "app.sqlite");
  const db = openAppDatabase(path);
  try {
    const rows = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='event_analysis'").all();
    expect(rows.length).toBe(1);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("openAppDatabase creates event_examples table", () => {
  const dir = mkdtempSync(join(tmpdir(), "sn-analytics-"));
  const path = join(dir, "app.sqlite");
  const db = openAppDatabase(path);
  try {
    const rows = db
      .query("SELECT name FROM sqlite_master WHERE type='table' AND name='event_examples'")
      .all();
    expect(rows.length).toBe(1);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("openAppDatabase creates repo_contributor table", () => {
  const dir = mkdtempSync(join(tmpdir(), "sn-analytics-"));
  const path = join(dir, "app.sqlite");
  const db = openAppDatabase(path);
  try {
    const rows = db
      .query("SELECT name FROM sqlite_master WHERE type='table' AND name='repo_contributor'")
      .all();
    expect(rows.length).toBe(1);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
