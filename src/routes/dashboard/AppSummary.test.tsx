import { expect, test } from "bun:test";
import { type ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { AppSummary, ampAiDiffPct, diffTone } from "./AppSummary";
import type { MigrationEvent, RepoRecord } from "@/lib/model";

function renderSummary(node: ReactNode): string {
  return renderToString(<MemoryRouter>{node}</MemoryRouter>);
}

const ev: MigrationEvent = {
  name: "General Experience Loading",
  legacy: ["GeneralExperienceLoadingEventV2"],
  status: "live",
  v30: 1000,
  v365: 1,
  dev30: 0,
  merged: false,
  pr: null,
  amp_count: 1,
  ss_error: "",
  queried: 0,
  series30: [1, 2, 3],
  ai30: 1100,
  aiSeries30: [1, 2, 3],
};

const repo: RepoRecord = {
  repo: "wdesk_sdk",
  events: [ev],
  counts: { live: 1 },
  total: 1,
  live: 1,
  volume30: 1000,
  volume30Ai: 1100,
  sources: [],
  prs: [],
  inv_mapped: 0,
  inv_unmapped: 0,
};

test("AppSummary groups Amplitude and App Intel columns without a 30d subheader", () => {
  const html = renderSummary(<AppSummary repo={repo} query="" tolerance={5} />);
  expect(html).toContain("Amplitude");
  expect(html).toContain("App Intel");
  expect(html).not.toContain("Last 30d");
  expect(html).not.toContain("30d vol");
  expect(html).toContain(">1K<");
  expect(html).toContain("sparkline");
  expect(html).toContain("Diff");
  expect(html).toContain(">-10%<");
  expect(html).toContain("color:var(--st-critical-ink)");
});

test("diffTone is green at or inside the tolerance and red outside it", () => {
  expect(diffTone(0, 1)).toBe("within");
  expect(diffTone(-10, 10)).toBe("within");
  expect(diffTone(10, 10)).toBe("within");
  expect(diffTone(-11, 10)).toBe("outside");
  expect(diffTone(null, 5)).toBeNull();
  const within = renderSummary(<AppSummary repo={repo} query="" tolerance={10} />);
  expect(within).toContain("color:var(--st-good-ink)");
  expect(within).not.toContain("color:var(--st-critical-ink)");
});

test("ampAiDiffPct is (Amplitude - App Intel) / Amplitude as a whole percent", () => {
  expect(ampAiDiffPct(1600, 1600)).toBe(0);
  expect(ampAiDiffPct(112000, 167000)).toBe(-49);
  expect(ampAiDiffPct(167000, 112000)).toBe(33);
  expect(ampAiDiffPct(0, 100)).toBeNull();
  expect(ampAiDiffPct(1000, null)).toBeNull();
  expect(ampAiDiffPct(1000, 0)).toBe(100);
});

function event(over: Partial<MigrationEvent> = {}): MigrationEvent {
  return {
    name: "Clicked Save",
    legacy: ["SaveEventV1"],
    status: "live",
    v30: 1000,
    v365: 1,
    dev30: 0,
    merged: false,
    pr: null,
    amp_count: 1,
    ss_error: "",
    queried: 0,
    ...over,
  };
}

function repoOf(events: MigrationEvent[], over: Partial<RepoRecord> = {}): RepoRecord {
  return {
    repo: "wdesk_sdk",
    events,
    counts: { live: events.filter((e) => e.status === "live").length },
    total: events.length,
    live: events.filter((e) => e.status === "live").length,
    volume30: events.reduce((sum, e) => sum + e.v30, 0),
    sources: [],
    prs: [],
    inv_mapped: 0,
    inv_unmapped: 0,
    ...over,
  };
}

test("AppSummary renders em dash when ai30 is null, not fmt(0)", () => {
  const html = renderSummary(
    <AppSummary repo={repoOf([event({ ai30: null })])} query="" tolerance={5} />,
  );
  expect(html).toContain("—");
  expect(html).not.toContain(">0<");
  expect(html).toContain('whitespace-nowrap w-[1%]">—</td>');
  expect(html).not.toContain("--st-good-ink");
  expect(html).not.toContain("--st-critical-ink");
});

test("AppSummary still ranks live events by Amplitude volume", () => {
  const html = renderSummary(
    <AppSummary
      repo={repoOf([
        event({ name: "High AI", v30: 10, ai30: 9000 }),
        event({ name: "High Amp", v30: 2000, ai30: 1 }),
        event({ name: "Stale High", status: "stale", v30: 9000, ai30: 9000 }),
      ])}
      query=""
      tolerance={5}
    />,
  );
  expect(html).toContain("High Amp");
  expect(html).toContain("High AI");
  expect(html.indexOf("High Amp")).toBeLessThan(html.indexOf("High AI"));
  expect(html).not.toContain("Stale High");
});

test("AppSummary omits sparklines when neither series is long enough", () => {
  const html = renderSummary(
    <AppSummary repo={repoOf([event({ series30: [1], aiSeries30: [1], ai30: 1100 })])} query="" tolerance={5} />,
  );
  expect(html).toContain("Amplitude");
  expect(html).toContain("App Intel");
  expect(html).not.toContain("sparkline");
  expect(html).not.toContain("30d vol");
});
