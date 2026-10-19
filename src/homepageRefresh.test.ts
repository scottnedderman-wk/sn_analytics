import { expect, test } from "bun:test";
import {
  aiHomepageDailySql,
  aiHomepageVolumeSql,
  ampHomepageDailySql,
  ampHomepageVolumeSql,
  refreshHomepageData,
} from "./homepageRefresh";
import type { DashboardData } from "./model";
import type { FetchImpl } from "./snowflakeEvents";

const window = { start: "2026-07-26", end: "2026-08-24" };

test("ampHomepageVolumeSql groups by source_event_type and restricts to mapped names", () => {
  const sql = ampHomepageVolumeSql(window, ["General Experience Loading", "O'Brien"]);
  expect(sql).toContain("gold_prod.marts.fct_amplitude_events");
  expect(sql).toContain("source_event_type");
  expect(sql).toContain("is_amplitude_generated_event = FALSE");
  expect(sql).toContain("environment IN ('us','eu','apac')");
  expect(sql).toContain("2026-07-26");
  expect(sql).toContain("2026-08-24");
  expect(sql).toContain("GROUP BY 1");
  expect(sql).toContain("'General Experience Loading'");
  expect(sql).toContain("'O''Brien'");
});

test("ampHomepageVolumeSql with empty names uses AND FALSE", () => {
  const sql = ampHomepageVolumeSql(window, []);
  expect(sql).toContain("AND FALSE");
  expect(sql).not.toContain("IN ()");
});

test("aiHomepageVolumeSql dedicated identities aggregate without grouping by event", () => {
  const sql = aiHomepageVolumeSql(window, [
    { aiCategory: "general", aiAction: "experience-loading" },
    { aiCategory: "workspace", aiAction: "create" },
  ]);
  expect(sql).toContain("NULL AS ev");
  expect(sql).toContain("(category, action) IN (('general','experience-loading'),('workspace','create'))");
  expect(sql).toContain("GROUP BY 1, 2");
  expect(sql).not.toContain("GROUP BY 1, 2, 3");
  expect(sql).not.toContain("dimensions:event::VARCHAR");
});

test("aiHomepageVolumeSql named identities compact event filters per pair", () => {
  const sql = aiHomepageVolumeSql(window, [
    { aiCategory: "shell", aiAction: "generic-analytic", aiEvent: "aboutWorkiva" },
    { aiCategory: "shell", aiAction: "generic-analytic", aiEvent: "O'Brien" },
  ]);
  expect(sql).toContain("dimensions:event::VARCHAR IN ('aboutWorkiva','O''Brien')");
  expect(sql).toContain("GROUP BY 1, 2, 3");
});

test("aiHomepageVolumeSql remainder identity aggregates without grouping by event", () => {
  const sql = aiHomepageVolumeSql(window, [
    { aiCategory: "shell", aiAction: "generic-analytic", aiEventExclude: ["aboutWorkiva"] },
  ]);
  expect(sql).toContain("NOT IN ('aboutWorkiva')");
  expect(sql).toContain("NOT LIKE 'progressItem.%'");
  expect(sql).toContain("NULL AS ev");
  expect(sql).not.toContain("GROUP BY 1, 2, 3");
});

test("aiHomepageVolumeSql with empty identities uses AND FALSE", () => {
  const sql = aiHomepageVolumeSql(window, []);
  expect(sql).toContain("AND FALSE");
  expect(sql).not.toContain("IN ()");
});

test("ampHomepageDailySql restricts to preview names", () => {
  const sql = ampHomepageDailySql(window, ["General Experience Loading", "O'Brien"]);
  expect(sql).toContain("event_date");
  expect(sql).toContain("TO_CHAR(event_date, 'YYYY-MM-DD')");
  expect(sql).toContain("'General Experience Loading'");
  expect(sql).toContain("'O''Brien'");
  expect(sql).toContain("GROUP BY 1, 2");
});

test("ampHomepageDailySql with empty names uses AND FALSE", () => {
  const sql = ampHomepageDailySql(window, []);
  expect(sql).toContain("AND FALSE");
  expect(sql).not.toContain("IN ()");
});

test("aiHomepageDailySql dedicated identities aggregate without grouping by event", () => {
  const sql = aiHomepageDailySql(window, [
    { aiCategory: "general", aiAction: "experience-loading" },
  ]);
  expect(sql).toContain("NULL AS ev");
  expect(sql).toContain("GROUP BY 1, 2, 4");
  expect(sql).not.toContain("GROUP BY 1, 2, 3, 4");
});

test("aiHomepageDailySql with empty identities uses AND FALSE", () => {
  const sql = aiHomepageDailySql(window, []);
  expect(sql).toContain("AND FALSE");
  expect(sql).not.toContain("IN ()");
});

test("aiHomepageDailySql remainder identity aggregates without grouping by event", () => {
  const sql = aiHomepageDailySql(window, [
    { aiCategory: "shell", aiAction: "generic-analytic", aiEventExclude: ["aboutWorkiva"] },
  ]);
  expect(sql).toContain("NOT IN ('aboutWorkiva')");
  expect(sql).toContain("NOT LIKE 'progressItem.%'");
  expect(sql).toContain("NULL AS ev");
  expect(sql).not.toContain("GROUP BY 1, 2, 3, 4");
});

test("refreshHomepageData writes only after both rollups succeed", async () => {
  const data: DashboardData = { provenance: "t", repos: [] };
  let written: DashboardData | null = null;
  let calls = 0;
  const fetchImpl: FetchImpl = async () => {
    calls += 1;
    return new Response(JSON.stringify({ data: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  const out = await refreshHomepageData({
    readData: () => data,
    writeData: async (next) => {
      written = next;
    },
    credsFromEnv: () => ({ pat: "tok" }),
    fetchImpl,
    now: () => new Date("2026-08-26T16:00:00Z"),
  });
  expect(written).toBe(out);
  expect(out.volumeAsOf).toBe("2026-08-24");
  expect(out.volumeRefreshedAt).toBe("2026-08-26T16:00:00.000Z");
  expect(calls).toBeGreaterThan(0);
});

test("refreshHomepageData volume SQL is bounded to mapped names and identities", async () => {
  const data: DashboardData = {
    provenance: "t",
    repos: [
      {
        repo: "wdesk_sdk",
        events: [
          {
            name: "About Workiva",
            legacy: [],
            status: "live",
            v30: 1,
            v365: 1,
            dev30: 0,
            merged: false,
            pr: null,
            amp_count: null,
            ss_error: "",
            queried: 0,
            aiCategory: "shell",
            aiAction: "generic-analytic",
            aiEvent: "aboutWorkiva",
          },
          {
            name: "Shell Generic Analytic",
            legacy: [],
            status: "live",
            v30: 2,
            v365: 2,
            dev30: 0,
            merged: false,
            pr: null,
            amp_count: null,
            ss_error: "",
            queried: 0,
            aiCategory: "shell",
            aiAction: "generic-analytic",
            aiEventExclude: ["aboutWorkiva"],
          },
        ],
        counts: { live: 2 },
        total: 2,
        live: 2,
        volume30: 3,
        sources: [],
        prs: [],
        inv_mapped: 0,
        inv_unmapped: 0,
      },
    ],
  };
  const statements: string[] = [];
  const fetchImpl: FetchImpl = async (_input, init) => {
    statements.push(JSON.parse(String(init?.body)).statement as string);
    return Response.json({ data: [] });
  };
  await refreshHomepageData({
    readData: () => data,
    writeData: async () => {},
    credsFromEnv: () => ({ pat: "tok" }),
    fetchImpl,
    now: () => new Date("2026-08-26T16:00:00Z"),
  });
  const ampVolume = statements.find(
    (sql) => sql.includes("source_event_type") && !sql.includes("TO_CHAR"),
  );
  const aiVolume = statements.find(
    (sql) => sql.includes("SILVER_PROD.ADMIN.USER_ANALYTIC") && !sql.includes("TO_CHAR"),
  );
  expect(ampVolume).toContain("'About Workiva'");
  expect(ampVolume).toContain("'Shell Generic Analytic'");
  expect(aiVolume).toContain("dimensions:event::VARCHAR IN ('aboutWorkiva')");
  expect(aiVolume).toContain("NOT IN ('aboutWorkiva')");
});

test("refreshHomepageData attaches a 30-day daily series at the matching date index", async () => {
  const data: DashboardData = {
    provenance: "t",
    repos: [
      {
        repo: "wdesk_sdk",
        events: [
          {
            name: "General Experience Loading",
            legacy: [],
            status: "missing",
            v30: 0,
            v365: 0,
            dev30: 0,
            merged: false,
            pr: null,
            amp_count: null,
            ss_error: "",
            queried: 0,
            aiCategory: "general",
            aiAction: "experience-loading",
          },
        ],
        counts: { missing: 1 },
        total: 1,
        live: 0,
        volume30: 0,
        sources: [],
        prs: [],
        inv_mapped: 0,
        inv_unmapped: 0,
      },
    ],
  };
  const fetchImpl: FetchImpl = async (_input, init) => {
    const statement = JSON.parse(String(init?.body)).statement as string;
    let rows: string[][];
    if (statement.includes("source_event_type") && statement.includes("TO_CHAR")) {
      rows = [["General Experience Loading", "2026-08-10", "7"]];
    } else if (statement.includes("source_event_type")) {
      rows = [["General Experience Loading", "21"]];
    } else if (statement.includes("TO_CHAR")) {
      rows = [["general", "experience-loading", "", "2026-08-10", "9"]];
    } else {
      rows = [["general", "experience-loading", "", "25"]];
    }
    return Response.json({ data: rows });
  };

  const out = await refreshHomepageData({
    readData: () => data,
    writeData: async () => {},
    credsFromEnv: () => ({ pat: "tok" }),
    fetchImpl,
    now: () => new Date("2026-08-26T16:00:00Z"),
  });

  const refreshed = out.repos[0]!.events[0]!;
  expect(refreshed.series30).toHaveLength(30);
  expect(refreshed.series30?.[15]).toBe(7);
  expect(refreshed.aiSeries30).toHaveLength(30);
  expect(refreshed.aiSeries30?.[15]).toBe(9);
});

test("refreshHomepageData does not write when Snowflake fails", async () => {
  const data: DashboardData = { provenance: "t", repos: [] };
  let wrote = false;
  await expect(
    refreshHomepageData({
      readData: () => data,
      writeData: async () => {
        wrote = true;
      },
      credsFromEnv: () => ({ pat: "tok" }),
      fetchImpl: async () => new Response("nope", { status: 500 }),
      now: () => new Date("2026-08-26T16:00:00Z"),
    }),
  ).rejects.toThrow();
  expect(wrote).toBe(false);
});
