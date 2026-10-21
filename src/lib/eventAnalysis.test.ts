import { expect, test } from "bun:test";
import { loadEventAnalysis } from "./eventAnalysis";
import type { MigrationEvent } from "./model";

function event(): MigrationEvent {
  return {
    name: "Remove Node",
    legacy: [],
    status: "live",
    v30: 100,
    v365: 0,
    dev30: 0,
    merged: false,
    pr: null,
    amp_count: null,
    ss_error: "",
    queried: 0,
    aiCategory: "outline",
    aiAction: "remove-node",
  };
}

const ampRow = ["2026-08-20 13:00:00", "user-1", "org-1", "ws-1", null, "eu", "https://app.example/a/sheet", "app.example", null];
const aiRow = ["2026-08-20 13:00:00", "user-1", "org-1", "ws-1", "18", "prod-eu", "https://app.example/a", "app.example", null];

test("analysis reports the region that holds the gap and how many samples match", async () => {
  const analysis = await loadEventAnalysis(event(), "2026-08-20", async (sql) => {
    if (sql.includes("GROUP BY 1") && sql.includes("fct_amplitude_events")) return [["eu", "100"], ["us", "5"]];
    if (sql.includes("GROUP BY 1")) return [["prod-eu", "180"]];
    if (sql.includes("LIMIT 20") && sql.includes("fct_amplitude_events")) return [ampRow];
    if (sql.includes("LIMIT 20")) return [aiRow];
    if (sql.includes("USER_ANALYTIC")) return [aiRow];
    if (sql.includes("fct_amplitude_events")) return [ampRow];
    return [];
  });
  expect(analysis.day).toBe("2026-08-20");
  expect(analysis.regions.find((region) => region.ampEnv === "eu")).toEqual({
    ampEnv: "eu",
    aiEnv: "prod-eu",
    amp: 100,
    ai: 180,
    diff: -80,
  });
  expect(analysis.ampSampled).toBe(1);
  expect(analysis.ampMatched).toBe(1);
  expect(analysis.aiSampled).toBe(1);
  expect(analysis.aiMatched).toBe(1);
  expect(analysis.sentence).toContain("eu accounts for most of the gap");
  expect(analysis.sentence).toContain("1 of 1 Amplitude examples match an App Intel event.");
});
