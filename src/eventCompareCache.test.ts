import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openAppDatabase } from "./db";
import { GEL_CONTRACT, type CompareSnapshot } from "./eventCompare";
import { getCompareCache, listCompareCache, pendingSnapshot, putCompareCache } from "./eventCompareCache";

function tmpDb() {
  const dir = mkdtempSync(join(tmpdir(), "sn-analytics-"));
  const db = openAppDatabase(join(dir, "app.sqlite"));
  return { dir, db };
}

const window = { start: "2026-08-19", end: "2026-08-25" };

test("put and list preserve snapshot; error does not wipe snapshot", () => {
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
    putCompareCache(db, {
      repo: "wdesk_sdk",
      eventName: GEL_CONTRACT.eventName,
      snapshot: snap,
      refreshedAt: "2026-08-26T00:00:00.000Z",
      lastError: "timeout",
    });
    const got = getCompareCache(db, "wdesk_sdk", GEL_CONTRACT.eventName);
    expect(got?.lastError).toBe("timeout");
    expect(got?.snapshot?.volume.amp).toBe(12);
    expect(listCompareCache(db, "wdesk_sdk")).toHaveLength(1);
    expect(listCompareCache(db, "w_outline")).toHaveLength(0);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
