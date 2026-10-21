import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openAppDatabase } from "@/lib/db";
import { putVolumeDaily } from "@/lib/eventVolumeCache";
import { eventVolumeGetResponse } from "./eventVolume";

test("eventVolumeGetResponse returns one event inside the requested window", () => {
  const dir = mkdtempSync(join(tmpdir(), "sn-analytics-"));
  const db = openAppDatabase(join(dir, "app.sqlite"));
  try {
    putVolumeDaily(db, [
      { source: "amp", repo: "w_outline", eventName: "Rename Outline Title", day: "2026-08-17", count: 10, fetchedAt: "2026-08-20T00:00:00.000Z" },
      { source: "ai", repo: "w_outline", eventName: "Rename Outline Title", day: "2026-08-17", count: 12, fetchedAt: "2026-08-20T00:00:00.000Z" },
      { source: "amp", repo: "w_outline", eventName: "Rename Outline Title", day: "2026-08-19", count: 99, fetchedAt: "2026-08-20T00:00:00.000Z" },
      { source: "amp", repo: "w_outline", eventName: "Other", day: "2026-08-17", count: 1, fetchedAt: "2026-08-20T00:00:00.000Z" },
    ]);
    expect(eventVolumeGetResponse(db, "w_outline", "Rename Outline Title", { start: "2026-08-17", end: "2026-08-18" }).rows).toEqual([
      { source: "ai", day: "2026-08-17", count: 12 },
      { source: "amp", day: "2026-08-17", count: 10 },
    ]);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
