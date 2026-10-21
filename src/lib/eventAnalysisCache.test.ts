import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openAppDatabase } from "./db";
import type { EventAnalysis } from "./eventAnalysis";
import { loadCachedEventAnalysis } from "./eventAnalysisCache";

const analysis: EventAnalysis = {
  day: "2026-08-20",
  regions: [{ ampEnv: "eu", aiEnv: "prod-eu", amp: 10, ai: 12, diff: -20 }],
  ampSampled: 20,
  ampMatched: 14,
  aiSampled: 20,
  aiMatched: 11,
  sentence: "On 2026-08-20, eu accounts for most of the gap.",
};

test("a saved analysis is reused for any window that contains its day", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sn-analytics-"));
  const db = openAppDatabase(join(dir, "app.sqlite"));
  try {
    let calls = 0;
    const load = async () => {
      calls += 1;
      return analysis;
    };
    const first = await loadCachedEventAnalysis(db, "w_outline", "Remove Node", { start: "2026-08-17", end: "2026-08-20" }, load, () => "2026-08-21T00:00:00.000Z");
    const second = await loadCachedEventAnalysis(db, "w_outline", "Remove Node", { start: "2026-08-20", end: "2026-08-20" }, load);
    expect(first.sentence).toBe(analysis.sentence);
    expect(second.ampMatched).toBe(14);
    expect(calls).toBe(1);
    await loadCachedEventAnalysis(db, "w_outline", "Remove Node", { start: "2026-08-17", end: "2026-08-19" }, load);
    expect(calls).toBe(2);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
