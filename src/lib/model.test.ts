import { expect, test } from "bun:test";
import {
  appHref,
  dashboardSummary,
  eventMatches,
  fmt,
  formatUpdatedAgo,
  isTemplateName,
  parseRoute,
  pctColor,
  repoCompletion,
  sortEvents,
  sparklinePath,
  topLiveByVolume,
  visibleRepos,
  type MigrationEvent,
  type RepoRecord,
} from "./model";

const event = (over: Partial<MigrationEvent> = {}): MigrationEvent => ({
  name: "Clicked Save",
  legacy: ["SaveEventV1"],
  status: "live",
  v30: 100,
  v365: 500,
  dev30: 0,
  merged: false,
  pr: null,
  amp_count: 1,
  ss_error: "",
  queried: 0,
  ...over,
});

const repo = (over: Partial<RepoRecord> = {}): RepoRecord => ({
  repo: "w_outline",
  events: [event()],
  counts: { live: 1 },
  total: 1,
  live: 1,
  volume30: 100,
  sources: ["burn"],
  prs: [],
  inv_mapped: 1,
  inv_unmapped: 0,
  ...over,
});

test("fmt uses K and M suffixes", () => {
  expect(fmt(12)).toBe("12");
  expect(fmt(1500)).toBe("2K");
  expect(fmt(226541700)).toBe("226.5M");
});

test("pctColor matches completion thresholds", () => {
  expect(pctColor(100)).toBe("var(--st-good-ink)");
  expect(pctColor(80)).toBe("var(--text-primary)");
  expect(pctColor(40)).toBe("var(--st-critical-ink)");
});

test("isTemplateName detects placeholders", () => {
  expect(isTemplateName("Clicked ${button}", [])).toBe(true);
  expect(isTemplateName("Clicked Save", ["SaveEventV1"])).toBe(false);
});

test("dashboardSummary matches the static report headline math", () => {
  const repos = [
    repo({ repo: "a", total: 10, counts: { live: 8, missing: 2 }, events: [] }),
    repo({ repo: "b", total: 0, counts: {}, events: [] }),
  ];
  const s = dashboardSummary(repos);
  expect(s.tracked).toBe(2);
  expect(s.unassessable).toBe(1);
  expect(s.applications).toBe(1);
  expect(s.mapped).toBe(10);
  expect(s.live).toBe(8);
  expect(s.missing).toBe(2);
  expect(s.scored).toBe(10);
  expect(s.pct).toBe(80);
});

test("sortEvents by volume then name", () => {
  const evs = [event({ name: "B", v30: 1 }), event({ name: "A", v30: 10 }), event({ name: "C", v30: 10 })];
  expect(sortEvents(evs, "volume").map((e) => e.name)).toEqual(["A", "C", "B"]);
  expect(sortEvents(evs, "name").map((e) => e.name)).toEqual(["A", "B", "C"]);
});

test("visibleRepos filters by query, status, and empty unassessable apps", () => {
  const empty = repo({ repo: "app_intelligence_dart", total: 0, events: [], counts: {}, live: 0, volume30: 0 });
  const outline = repo({
    events: [event({ name: "Add Node", status: "live" }), event({ name: "Before", status: "missing", v30: 0 })],
    total: 2,
    counts: { live: 1, missing: 1 },
  });
  const repos = [outline, empty];

  expect(visibleRepos(repos, "", "all", "name").map((r) => r.repo.repo)).toEqual([
    "w_outline",
    "app_intelligence_dart",
  ]);
  expect(visibleRepos(repos, "Before", "all", "name")[0]?.events.map((e) => e.name)).toEqual(["Before"]);
  expect(visibleRepos(repos, "", "missing", "name")[0]?.events.map((e) => e.name)).toEqual(["Before"]);
  expect(visibleRepos(repos, "nope", "all", "name")).toEqual([]);
  expect(eventMatches(event(), "w_outline", "outline", "all")).toBe(true);
});

test("appHref encodes the repo in /app/<repo>", () => {
  expect(appHref("w_outline")).toBe("/app/w_outline");
  expect(appHref("weird repo")).toBe("/app/weird%20repo");
});

test("parseRoute recognizes home, app, and unknown paths", () => {
  expect(parseRoute("/")).toEqual({ page: "home" });
  expect(parseRoute("/app/w_outline")).toEqual({ page: "app", repo: "w_outline" });
  expect(parseRoute("/app/w_outline/")).toEqual({ page: "app", repo: "w_outline" });
  expect(parseRoute("/app/weird%20repo")).toEqual({ page: "app", repo: "weird repo" });
  expect(parseRoute("/app")).toEqual({ page: "unknown" });
  expect(parseRoute("/nope")).toEqual({ page: "unknown" });
});

test("repoCompletion treats empty mapping as unassessable", () => {
  expect(repoCompletion(repo({ total: 0, counts: {}, live: 0 }))).toEqual({
    live: 0,
    missing: 0,
    scored: 0,
    pct: null,
    unassessable: true,
  });
  expect(repoCompletion(repo({ total: 10, counts: { live: 8, missing: 2 } })).pct).toBe(80);
});

test("topLiveByVolume returns the highest-volume live events", () => {
  const evs = [
    event({ name: "Blocked", status: "blocked", v30: 99 }),
    event({ name: "Low", status: "live", v30: 1 }),
    event({ name: "High", status: "live", v30: 50 }),
    event({ name: "Mid", status: "live", v30: 10 }),
    event({ name: "Missing", status: "missing", v30: 0 }),
    event({ name: "TieA", status: "live", v30: 10 }),
    event({ name: "Extra", status: "live", v30: 2 }),
  ];
  expect(topLiveByVolume(evs, 3).map((e) => e.name)).toEqual(["High", "Mid", "TieA"]);
  expect(topLiveByVolume(evs, 5).map((e) => e.name)).toEqual(["High", "Mid", "TieA", "Extra", "Low"]);
  expect(topLiveByVolume(evs, 5)).toHaveLength(5);
});

test("sparklinePath baselines at zero and skips empty series", () => {
  expect(sparklinePath([], 100, 20)).toBe("");
  expect(sparklinePath([4], 100, 20)).toBe("");
  expect(sparklinePath([0, 10, 5], 100, 20)).toBe("M0.0,20.0 L50.0,0.0 L100.0,10.0");
});

test("formatUpdatedAgo uses today / yesterday / N days ago", () => {
  const now = new Date("2026-09-16T18:00:00Z");
  expect(formatUpdatedAgo("2026-09-16T12:00:00.000Z", now)).toBe("Updated today");
  expect(formatUpdatedAgo("2026-09-15T00:00:00.000Z", now)).toBe("Updated yesterday");
  expect(formatUpdatedAgo("2026-09-13", now)).toBe("Updated 3 days ago");
});
