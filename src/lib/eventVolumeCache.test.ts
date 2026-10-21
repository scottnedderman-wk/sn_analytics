import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openAppDatabase } from "./db";
import {
  eventVolumeSeries,
  listEventVolumeDaily,
  listVolumeDaily,
  markVolumeDaysFetched,
  missingVolumeDays,
  putVolumeDaily,
} from "./eventVolumeCache";

function tmpDb() {
  const dir = mkdtempSync(join(tmpdir(), "sn-analytics-"));
  const db = openAppDatabase(join(dir, "app.sqlite"));
  return { dir, db };
}

const window = { start: "2026-08-17", end: "2026-08-18" };

test("missingVolumeDays is the whole window until a source is marked fetched", () => {
  const { dir, db } = tmpDb();
  try {
    expect(missingVolumeDays(db, "amp", window)).toEqual(["2026-08-17", "2026-08-18"]);
    markVolumeDaysFetched(db, "amp", ["2026-08-17"], "2026-08-20T00:00:00.000Z");
    expect(missingVolumeDays(db, "amp", window)).toEqual(["2026-08-18"]);
    expect(missingVolumeDays(db, "ai", window)).toEqual(["2026-08-17", "2026-08-18"]);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("put and list volume daily rows for a window", () => {
  const { dir, db } = tmpDb();
  try {
    putVolumeDaily(db, [
      {
        source: "amp",
        repo: "wdesk_sdk",
        eventName: "General Experience Loading",
        day: "2026-08-17",
        count: 4,
        fetchedAt: "2026-08-20T00:00:00.000Z",
      },
      {
        source: "ai",
        repo: "wdesk_sdk",
        eventName: "General Experience Loading",
        day: "2026-08-17",
        count: 5,
        fetchedAt: "2026-08-20T00:00:00.000Z",
      },
      {
        source: "amp",
        repo: "wdesk_sdk",
        eventName: "General Experience Loading",
        day: "2026-08-19",
        count: 9,
        fetchedAt: "2026-08-20T00:00:00.000Z",
      },
    ]);
    const rows = listVolumeDaily(db, window);
    expect(listEventVolumeDaily(db, "wdesk_sdk", "General Experience Loading", window).map((row) => [row.source, row.day, row.count])).toEqual([
      ["ai", "2026-08-17", 5],
      ["amp", "2026-08-17", 4],
    ]);
    expect(rows).toEqual([
      {
        source: "ai",
        repo: "wdesk_sdk",
        eventName: "General Experience Loading",
        day: "2026-08-17",
        count: 5,
        fetchedAt: "2026-08-20T00:00:00.000Z",
      },
      {
        source: "amp",
        repo: "wdesk_sdk",
        eventName: "General Experience Loading",
        day: "2026-08-17",
        count: 4,
        fetchedAt: "2026-08-20T00:00:00.000Z",
      },
    ]);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("eventVolumeSeries fills every day in the window", () => {
  const rows = [
    { source: "amp" as const, day: "2026-08-17", count: 4 },
    { source: "ai" as const, day: "2026-08-18", count: 7 },
  ];
  expect(eventVolumeSeries(window, rows, true)).toEqual([
    { date: "2026-08-17", amp: 4, ai: 0 },
    { date: "2026-08-18", amp: 0, ai: 7 },
  ]);
  expect(eventVolumeSeries(window, rows, false)).toEqual([
    { date: "2026-08-17", amp: 4, ai: null },
    { date: "2026-08-18", amp: 0, ai: null },
  ]);
});
