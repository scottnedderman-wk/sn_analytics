import { expect, test } from "bun:test";
import { ampSampleSql, aiMatchSql, aiSampleSql, exampleFieldRows, loadEventSample, parseProperties, sampleSideFromRow } from "./eventSample";
import type { MigrationEvent } from "./model";

const window = { start: "2026-08-17", end: "2026-08-19" };

function event(over: Partial<MigrationEvent> = {}): MigrationEvent {
  return {
    name: "Rename Outline Title",
    legacy: ["OutlineRenameTitleEventV1"],
    status: "live",
    v30: 0,
    v365: 0,
    dev30: 0,
    merged: false,
    pr: null,
    amp_count: null,
    ss_error: "",
    queried: 0,
    aiCategory: "outline",
    aiAction: "rename-title",
    ...over,
  };
}

const ampRow = ["2026-08-19 15:01:02", "user-1", "org-1", "ws-1", "12", "us", "https://app.example/a", "app.example"];

test("amplitude sample stays inside one day and the mapped environments", () => {
  const sql = ampSampleSql("O'Brien", window, "2026-08-19");
  expect(sql).toContain("source_event_type = 'O''Brien'");
  expect(sql).toContain("event_date = '2026-08-19'");
  expect(sql).toContain("environment IN ('us','eu','apac')");
  expect(sql).toContain("LIMIT 1");
  expect(sql).toContain("raw_event_properties::VARCHAR");
  expect(sql).not.toContain("BETWEEN");
});

test("property rows keep values that exist on only one side", () => {
  expect(parseProperties('{"experienceName":"Outline","empty":null,"nested":{"a":1}}')).toEqual({
    experienceName: "Outline",
    nested: '{"a":1}',
  });
  const amp = sampleSideFromRow([...ampRow, '{"experienceName":"Outline"}'])!;
  const ai = sampleSideFromRow([...ampRow.slice(0, 5), "production", ampRow[6], ampRow[7], '{"browser":"Chrome"}'])!;
  const rows = exampleFieldRows({ paired: true, amp, ai });
  const experience = rows.find((row) => row.key === "experienceName");
  const browser = rows.find((row) => row.key === "browser");
  expect(experience).toEqual({ key: "experienceName", label: "experienceName", amp: "Outline", ai: null });
  expect(browser).toEqual({ key: "browser", label: "browser", amp: null, ai: "Chrome" });
  expect(rows[0]?.key).toBe("eventTime");
});

test("App Intel match uses the mapped environment and requires a unique row", () => {
  const sql = aiMatchSql(event(), sampleSideFromRow(ampRow)!, "2026-08-19");
  expect(sql).toContain("category = 'outline'");
  expect(sql).toContain("action = 'rename-title'");
  expect(sql).toContain("environment = 'production'");
  expect(sql).toContain("EQUAL_NULL(dimensions:user_resource_id::VARCHAR, 'user-1')");
  expect(sql).toContain("EQUAL_NULL(dimensions:host::VARCHAR, 'app.example')");
  expect(sql).not.toContain("EQUAL_NULL(dimensions:url");
  expect(sql).toContain("TRY_TO_TIMESTAMP('2026-08-19 15:01:02')");
  expect(sql).toContain("LIMIT 2");
});

test("App Intel sample keeps named exclusions", () => {
  const sql = aiSampleSql(event({ aiEvent: "renameTitle", aiCategory: "shell", aiAction: "generic-analytic" }), window);
  expect(sql).toContain("dimensions:event::VARCHAR = 'renameTitle'");
  expect(sql).toContain("BETWEEN '2026-08-17' AND '2026-08-19'");
  expect(sql).toContain("environment IN ('production','prod-eu','prod-apac')");
});

test("a single fingerprint match is the same event", async () => {
  const calls: string[] = [];
  const sample = await loadEventSample(event(), window, async (sql) => {
    calls.push(sql);
    if (sql.includes("COUNT(*)")) return [[...ampRow, "1"]];
    if (sql.includes("USER_ANALYTIC")) {
      return [["2026-08-19 15:01:02", "user-1", "org-1", "ws-1", "12", "production", "https://app.example/a", "app.example"]];
    }
    if (sql.includes("LIMIT 20")) return [ampRow];
    return [];
  });
  expect(sample.paired).toBe(true);
  expect(sample.amp?.environment).toBe("us");
  expect(sample.ai?.environment).toBe("production");
  expect(calls.some((sql) => sql.includes("LIMIT 1") && sql.includes("USER_ANALYTIC"))).toBe(false);
});

test("a deeper Amplitude URL still pairs with the same App Intel page", async () => {
  const deeper = [...ampRow];
  deeper[6] = "https://app.example/a/sheet/1";
  const ai = ["2026-08-19 15:01:02", "user-1", "org-1", "ws-1", "20", "production", "https://app.example/a", "app.example"];
  const sample = await loadEventSample(event(), window, async (sql) => {
    if (sql.includes("COUNT(*)")) return [[...deeper, "1"]];
    if (sql.includes("USER_ANALYTIC")) return [ai, ai];
    if (sql.includes("LIMIT 20")) return [deeper];
    return [];
  });
  expect(sample.paired).toBe(true);
  expect(sample.amp?.pageUrl).toBe("https://app.example/a/sheet/1");
  expect(sample.ai?.pageUrl).toBe("https://app.example/a");
  expect(sample.ai?.duration).toBe("20");
});

test("more than one fingerprint match stays two separate examples", async () => {
  const sample = await loadEventSample(event(), window, async (sql) => {
    if (sql.includes("LIMIT 20")) return [ampRow];
    if (sql.includes("LIMIT 1") && sql.includes("USER_ANALYTIC")) {
      return [["2026-08-19 09:00:00", "other", "org-1", "ws-1", null, "production", "https://app.example/b", "app.example"]];
    }
    return [];
  });
  expect(sample.paired).toBe(false);
  expect(sample.amp?.user).toBe("user-1");
  expect(sample.ai?.user).toBe("other");
});

test("an event with no App Intel identity does not query App Intel", async () => {
  const sources: string[] = [];
  const sample = await loadEventSample(event({ aiCategory: undefined, aiAction: undefined }), window, async (sql, source) => {
    sources.push(source);
    return sql.includes("event_date = '2026-08-19'") ? [ampRow] : [];
  });
  expect(sample.ai).toBeNull();
  expect(sources).toEqual(["amp"]);
});
