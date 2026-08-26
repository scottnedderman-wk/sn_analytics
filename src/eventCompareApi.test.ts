import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openAppDatabase } from "./db";
import { GEL_CONTRACT, type CompareSnapshot } from "./eventCompare";
import { pendingSnapshot, putCompareCache } from "./eventCompareCache";
import { compareGetResponse, compareRoutes, decodeRouteParam } from "./eventCompareApi";
import type { FetchImpl } from "./snowflakeEvents";

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

test("decodeRouteParam is safe for already-decoded values and stray %", () => {
  expect(decodeRouteParam("General%20Experience%20Loading")).toBe("General Experience Loading");
  expect(decodeRouteParam("General Experience Loading")).toBe("General Experience Loading");
  expect(decodeRouteParam("100%")).toBe("100%");
});

test("per-event refresh handler rejects wrong repo and accepts GEL at the guard", async () => {
  const { dir, db } = tmpDb();
  try {
    const fetchImpl: FetchImpl = async () => {
      throw new Error("no network");
    };
    const POST = compareRoutes(db, {
      credsFromEnv: () => ({ pat: "tok" }),
      fetchImpl,
    })["/api/compare/:repo/events/:eventName/refresh"].POST;

    const wrong = await POST({ params: { repo: "w_outline", eventName: GEL_CONTRACT.eventName } });
    expect(wrong.status).toBe(500);
    expect(await wrong.json()).toEqual({
      error: `${GEL_CONTRACT.eventName} does not belong to w_outline`,
    });

    const ok = await POST({ params: { repo: "wdesk_sdk", eventName: GEL_CONTRACT.eventName } });
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as { rows: Array<{ eventName: string }>; error?: string };
    expect(body.error).toBeUndefined();
    expect(body.rows[0]!.eventName).toBe(GEL_CONTRACT.eventName);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
