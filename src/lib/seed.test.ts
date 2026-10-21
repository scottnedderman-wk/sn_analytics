import { expect, test } from "bun:test";
import { seedJsonUrl } from "./dataPath";
import { hydrateSeed, type SeedData } from "./seed";

test("seedJsonUrl points at the tracked catalog", () => {
  expect(seedJsonUrl.pathname.endsWith("/data/seed.json")).toBe(true);
});

test("hydrateSeed fills dashboard rollups and leaves volumes empty", () => {
  const seed: SeedData = {
    repos: [
      {
        repo: "wdesk_sdk",
        events: [
          {
            name: "General Experience Loading",
            legacy: ["GeneralExperienceLoadingEventV2"],
            status: "live",
            aiCategory: "general",
            aiAction: "experience-loading",
          },
          {
            name: "Missing Event",
            legacy: ["GoneEventV1"],
            status: "missing",
          },
        ],
      },
      { repo: "app_intelligence_dart", events: [] },
    ],
  };
  const data = hydrateSeed(seed);
  expect(data.provenance).toContain("seed.json");
  expect(data.volumeAsOf).toBeUndefined();
  expect(data.repos).toHaveLength(2);

  const sdk = data.repos[0]!;
  expect(sdk.total).toBe(2);
  expect(sdk.live).toBe(1);
  expect(sdk.counts).toEqual({ live: 1, missing: 1 });
  expect(sdk.volume30).toBe(0);
  expect(sdk.volume30Ai).toBe(0);
  expect(sdk.events[0]).toMatchObject({
    name: "General Experience Loading",
    v30: 0,
    v365: 0,
    dev30: 0,
    merged: false,
    pr: null,
    aiCategory: "general",
    aiAction: "experience-loading",
  });

  const empty = data.repos[1]!;
  expect(empty.total).toBe(0);
  expect(empty.events).toEqual([]);
  expect(empty.volume30).toBe(0);
});
