import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openAppDatabase } from "./db";
import { GEL_CONTRACT, contractFor } from "./eventCompare";
import {
  aiFillSql,
  aiVolumeSql,
  ampFillSql,
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
const window = { start: "2026-08-18", end: "2026-08-24" };

function requestBody(init?: RequestInit): { statement: string; warehouse: string } {
  return JSON.parse(String(init?.body)) as { statement: string; warehouse: string };
}

test("ampVolumeSql groups GEL counts by event_date", () => {
  const sql = ampVolumeSql(GEL_CONTRACT, window);
  expect(sql).toContain("source_event_type = 'General Experience Loading'");
  expect(sql).toContain("environment IN ('us','eu','apac')");
  expect(sql).toContain("2026-08-18");
  expect(sql).toContain("2026-08-24");
  expect(sql).toContain("GROUP BY 1");
  expect(sql).toContain("event_date");
});

test("aiVolumeSql uses ADMIN.USER_ANALYTIC and dimensions timestamp", () => {
  const sql = aiVolumeSql(GEL_CONTRACT, window);
  expect(sql).toContain("SILVER_PROD.ADMIN.USER_ANALYTIC");
  expect(sql).toContain("category = 'general'");
  expect(sql).toContain("action = 'experience-loading'");
  expect(sql).toContain("TRY_TO_TIMESTAMP(dimensions:timestamp::VARCHAR)::DATE");
  expect(sql).not.toContain("analytic_date");
  expect(sql).not.toContain("general_experience_loading");
  expect(sql).toContain("GROUP BY 1");
});

test("aiVolumeSql filters named shell events by dimensions:event", () => {
  const c = contractFor("About Workiva")!;
  const sql = aiVolumeSql(c, window);
  expect(sql).toContain("category = 'shell'");
  expect(sql).toContain("action = 'generic-analytic'");
  expect(sql).toContain("dimensions:event::VARCHAR = 'aboutWorkiva'");
  expect(sql).not.toContain("NOT IN");
});

test("aiVolumeSql for Shell Generic Analytic excludes named events", () => {
  const c = contractFor("Shell Generic Analytic")!;
  const sql = aiVolumeSql(c, window);
  expect(sql).toContain("category = 'shell'");
  expect(sql).toContain("NOT IN");
  expect(sql).toContain("experienceAlreadyOpen");
  expect(sql).toContain("NOT LIKE 'progressItem.%'");
  expect(sql).not.toContain("dimensions:event::VARCHAR = '");
});

test("fill SQL counts contracted columns including page fields", () => {
  expect(ampFillSql(GEL_CONTRACT, window)).toContain("COUNT(page_url)");
  expect(ampFillSql(GEL_CONTRACT, window)).toContain("COUNT(page_domain)");
  expect(aiFillSql(GEL_CONTRACT, window)).toContain("COUNT(dimensions:user_resource_id)");
  expect(aiFillSql(GEL_CONTRACT, window)).toContain("COUNT(dimensions:url)");
  expect(aiFillSql(GEL_CONTRACT, window)).toContain("COUNT(value)");
});

test("refresh keeps Amplitude data when App Intel returns 408", async () => {
  const { dir, db } = tmpDb();
  try {
    let calls = 0;
    const fetchImpl: FetchImpl = async () => {
      calls += 1;
      if (calls === 1) return jsonResponse(200, { data: [["2026-08-18", "40"], ["2026-08-19", "60"]] });
      if (calls === 2) {
        return jsonResponse(200, {
          data: [["100", "100", "90", "90", "90", "80", "100", "100", "100"]],
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

test("refresh scores volume on overlap days and uses the App Intel warehouse", async () => {
  const { dir, db } = tmpDb();
  try {
    const warehouses: string[] = [];
    let calls = 0;
    const fetchImpl: FetchImpl = async (_input, init) => {
      warehouses.push(requestBody(init).warehouse);
      calls += 1;
      if (calls === 1) return jsonResponse(200, { data: [["2026-08-18", "50"], ["2026-08-19", "50"]] });
      if (calls === 2) {
        return jsonResponse(200, {
          data: [["100", "100", "100", "100", "100", "100", "100", "100", "100"]],
        });
      }
      if (calls === 3) return jsonResponse(200, { data: [["2026-08-18", "40"]] });
      return jsonResponse(200, {
        data: [["40", "40", "40", "40", "40", "40", "40", "40", "40"]],
      });
    };

    const row = await refreshEventCompare(
      "wdesk_sdk",
      "General Experience Loading",
      db,
      { pat: "tok" },
      { fetchImpl, now: fixedNow },
    );

    expect(warehouses.slice(0, 2).every((w) => w === "PROD_WH")).toBe(true);
    expect(warehouses.slice(2).every((w) => w === "PROD_SILVER_LARGE_DBT_WAREHOUSE")).toBe(true);
    expect(row.snapshot?.volume).toEqual({ ai: 40, amp: 50 });
    expect(row.parts.volume).toBe(80);
    expect(row.snapshot?.daily?.find((d) => d.date === "2026-08-18")).toEqual({
      date: "2026-08-18",
      ai: 40,
      amp: 50,
    });
    expect(row.snapshot?.daily?.find((d) => d.date === "2026-08-19")).toEqual({
      date: "2026-08-19",
      ai: null,
      amp: 50,
    });
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("refreshEventCompare rejects a contract that belongs to another repo", async () => {
  const { dir, db } = tmpDb();
  try {
    await expect(
      refreshEventCompare("w_outline", "General Experience Loading", db, { pat: "tok" }, {
        fetchImpl: async () => jsonResponse(200, { data: [["0"]] }),
        now: fixedNow,
      }),
    ).rejects.toThrow("General Experience Loading does not belong to w_outline");
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
