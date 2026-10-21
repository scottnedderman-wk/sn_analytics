import { expect, test } from "bun:test";
import {
  applyVolumes,
  attachSeries30,
  collapsedTotals,
  lastNDayRange,
  mapDailySeries,
  previewLiveNames,
  recountRepo,
  statusAfterVolume,
  type MigrationEvent,
  type RepoRecord,
} from "./amplitudeRefresh";

const event = (over: Partial<MigrationEvent> = {}): MigrationEvent => ({
  name: "Clicked Save",
  legacy: ["SaveEventV1"],
  status: "missing",
  v30: 0,
  v365: 0,
  dev30: 0,
  merged: false,
  pr: null,
  amp_count: null,
  ss_error: "",
  queried: 0,
  ...over,
});

const repo = (over: Partial<RepoRecord> = {}): RepoRecord => ({
  repo: "w_outline",
  events: [event()],
  counts: { missing: 1 },
  total: 1,
  live: 0,
  volume30: 0,
  sources: ["burn"],
  prs: [],
  inv_mapped: 1,
  inv_unmapped: 0,
  ...over,
});

test("lastNDayRange is 30 inclusive UTC days ending today", () => {
  const r = lastNDayRange(30, new Date("2026-08-24T15:00:00Z"));
  expect(r.end).toBe("20260824");
  expect(r.start).toBe("20260726");
  expect(r.endIso).toBe("2026-08-24");
});

test("statusAfterVolume prefers live, keeps blocked, else stale/dev/missing", () => {
  expect(statusAfterVolume(event({ status: "blocked" }), 99)).toBe("blocked");
  expect(statusAfterVolume(event(), 10, true)).toBe("blocked");
  expect(statusAfterVolume(event({ status: "missing" }), 5)).toBe("live");
  expect(statusAfterVolume(event({ status: "live", v365: 100 }), 0)).toBe("stale");
  expect(statusAfterVolume(event({ status: "missing", v365: 9 }), 0)).toBe("stale");
  expect(statusAfterVolume(event({ status: "missing", dev30: 3 }), 0)).toBe("dev_only");
  expect(statusAfterVolume(event({ status: "missing" }), 0)).toBe("missing");
});

test("applyVolumes updates v30, status, and repo rollups", () => {
  const data = {
    provenance: "mapping",
    repos: [
      repo({
        events: [
          event({ name: "A", status: "missing" }),
          event({ name: "B", status: "live", v30: 9, v365: 20 }),
        ],
        total: 2,
      }),
    ],
  };
  const volumes = new Map([
    ["A", 100],
    ["B", 0],
  ]);
  const out = applyVolumes(data, volumes, new Set(), "2026-08-24");
  expect(out.volumeAsOf).toBe("2026-08-24");
  expect(out.volumeWindowDays).toBe(30);
  expect(out.repos[0]?.events[0]?.status).toBe("live");
  expect(out.repos[0]?.events[0]?.v30).toBe(100);
  expect(out.repos[0]?.events[1]?.status).toBe("stale");
  expect(out.repos[0]?.live).toBe(1);
  expect(out.repos[0]?.volume30).toBe(100);
  expect(out.repos[0]?.counts).toEqual({ live: 1, stale: 1 });
});

test("recountRepo leaves empty unassessable repos alone", () => {
  const empty = repo({ events: [], total: 0, counts: {}, live: 0, volume30: 0 });
  expect(recountRepo(empty)).toEqual(empty);
});

test("collapsedTotals reads Amplitude seriesCollapsed values", () => {
  expect(collapsedTotals([[{ value: 12 }], [{ value: 0 }], undefined])).toEqual([12, 0, 0]);
});

test("previewLiveNames is unique top-5 live per repo", () => {
  const data = {
    provenance: "t",
    repos: [
      repo({
        events: [
          event({ name: "A", status: "live", v30: 30 }),
          event({ name: "B", status: "live", v30: 20 }),
          event({ name: "C", status: "blocked", v30: 99 }),
        ],
      }),
      repo({
        repo: "other",
        events: [
          event({ name: "A", status: "live", v30: 5 }),
          event({ name: "D", status: "live", v30: 4 }),
        ],
      }),
    ],
  };
  expect(previewLiveNames(data)).toEqual(["A", "B", "D"]);
});

test("mapDailySeries maps Amplitude event ids to names", () => {
  const byId = new Map([
    ["11", { id: 11, value: "Rename Outline Title" }],
    ["22", { id: 22, value: "Other" }],
  ]);
  const mapped = mapDailySeries(["11", "99"], [[1, 2], [9, 8]], byId);
  expect(mapped.get("Rename Outline Title")).toEqual([1, 2]);
  expect(mapped.has("Other")).toBe(false);
});

test("attachSeries30 writes daily series only onto requested names", () => {
  const data = {
    provenance: "t",
    repos: [
      repo({
        events: [event({ name: "A", status: "live", v30: 10 }), event({ name: "B", status: "live", v30: 9 })],
      }),
    ],
  };
  const series = new Map([
    ["A", [1, 2, 3]],
    ["B", [4, 5, 6]],
  ]);
  const out = attachSeries30(data, series, ["A"]);
  expect(out.repos[0]?.events[0]?.series30).toEqual([1, 2, 3]);
  expect(out.repos[0]?.events[1]?.series30).toBeUndefined();
});
