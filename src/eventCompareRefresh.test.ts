import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openAppDatabase } from "./db";
import { GEL_CONTRACT } from "./eventCompare";
import {
  ampVolumeSql,
  refreshEventCompare,
  refreshRepoCompares,
} from "./eventCompareRefresh";
import type { FetchImpl } from "./snowflakeEvents";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function tmpDb() {
  const dir = mkdtempSync(join(tmpdir(), "sn-analytics-"));
  const db = openAppDatabase(join(dir, "app.sqlite"));
  return { dir, db };
}

const fixedNow = () => new Date("2026-08-26T16:00:00Z");
const window = { start: "2026-08-19", end: "2026-08-25" };

test("ampVolumeSql contains GEL filters and window dates", () => {
  const sql = ampVolumeSql(GEL_CONTRACT, window);
  expect(sql).toContain("source_event_type = 'General Experience Loading'");
  expect(sql).toContain("environment IN ('us','eu','apac')");
  expect(sql).toContain("2026-08-19");
  expect(sql).toContain("2026-08-25");
});

test("refresh keeps Amplitude data when App Intel returns 408", async () => {
  const { dir, db } = tmpDb();
  try {
    let calls = 0;
    const fetchImpl: FetchImpl = async () => {
      calls += 1;
      if (calls === 1) return jsonResponse(200, { data: [["100"]] });
      if (calls === 2) {
        return jsonResponse(200, {
          data: [["100", "100", "90", "90", "90", "80", "100"]],
        });
      }
      return jsonResponse(408, { message: "Request Timeout" });
    };

    const row = await refreshEventCompare(
      "wdesk_sdk",
      "General Experience Loading",
      db,
      { pat: "tok" },
      { fetchImpl, now: fixedNow },
    );

    expect(row.snapshot?.volume.amp).toBe(100);
    expect(row.snapshot?.volume.ai).toBeNull();
    expect(row.lastError).toInclude("408");
    expect(row.parts.volume).toBeNull();
    expect(row.parts.present).toBe(100);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("refreshRepoCompares returns empty for repos without contracts", async () => {
  const { dir, db } = tmpDb();
  try {
    let called = false;
    const fetchImpl: FetchImpl = async () => {
      called = true;
      return jsonResponse(200, { data: [["0"]] });
    };
    const rows = await refreshRepoCompares("w_outline", db, { pat: "tok" }, {
      fetchImpl,
      now: fixedNow,
    });
    expect(rows).toEqual([]);
    expect(called).toBe(false);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
