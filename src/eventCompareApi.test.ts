import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openAppDatabase } from "./db";
import { GEL_CONTRACT, type CompareSnapshot } from "./eventCompare";
import { pendingSnapshot, putCompareCache } from "./eventCompareCache";
import { compareGetResponse } from "./eventCompareApi";

function tmpDb() {
  const dir = mkdtempSync(join(tmpdir(), "sn-analytics-"));
  const db = openAppDatabase(join(dir, "app.sqlite"));
  return { dir, db };
}

const window = { start: "2026-08-19", end: "2026-08-25" };

test("compareGetResponse returns cached rows for repo only", () => {
  const { dir, db } = tmpDb();
  try {
    const snap: CompareSnapshot = {
      version: 1,
      window,
      volume: { ai: null, amp: 12 },
      fields: pendingSnapshot(GEL_CONTRACT, window).fields,
    };
    putCompareCache(db, {
      repo: "wdesk_sdk",
      eventName: GEL_CONTRACT.eventName,
      snapshot: snap,
      refreshedAt: "2026-08-26T00:00:00.000Z",
      lastError: null,
    });

    expect(compareGetResponse(db, "wdesk_sdk").rows[0]!.eventName).toBe(
      GEL_CONTRACT.eventName,
    );
    expect(compareGetResponse(db, "w_outline").rows).toEqual([]);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
