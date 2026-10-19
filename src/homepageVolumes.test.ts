import { expect, test } from "bun:test";
import { contractFor } from "./eventCompare";
import {
  aiCountForEvent,
  applyHomepageVolumes,
  homepageDayWindow,
  identityFromLegacy,
  seedAiIdentities,
  type AiCell,
} from "./homepageVolumes";
import type { DashboardData, MigrationEvent } from "./model";

test("homepageDayWindow is 30 UTC days ending 2 days ago", () => {
  expect(homepageDayWindow(new Date("2026-08-26T16:00:00Z"))).toEqual({
    start: "2026-07-26",
    end: "2026-08-24",
  });
});

const event = (over: Partial<MigrationEvent> = {}): MigrationEvent => ({
  name: "Clicked Save",
  legacy: ["SaveEventV1"],
  status: "live",
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

test("identityFromLegacy maps named shell dual-writes", () => {
  expect(identityFromLegacy(["ShellGenericAnalyticEventV2", "aboutWorkiva"])).toEqual({
    aiCategory: "shell",
    aiAction: "generic-analytic",
    aiEvent: "aboutWorkiva",
  });
  expect(identityFromLegacy(["SaveEventV1"])).toBeNull();
  expect(identityFromLegacy(["ShellGenericAnalyticEventV2"])).toBeNull();
});

test("identityFromLegacy maps kebab eventName tokens", () => {
  expect(identityFromLegacy(["DatatableExportEventV6", "datatable_export_v6"])).toEqual({
    aiCategory: "datatable",
    aiAction: "export",
  });
  expect(identityFromLegacy(["graphDb_data-modify-relationship_v1 (add)"])).toEqual({
    aiCategory: "graphDb",
    aiAction: "data-modify-relationship",
  });
});

test("identityFromLegacy maps generated EventV class names", () => {
  expect(identityFromLegacy(["OutlineAddNewNodeEventV1"])).toEqual({
    aiCategory: "outline",
    aiAction: "add-new-node",
  });
  expect(identityFromLegacy(["`FilingLiveFileAcknowledgementClickedEventV1`"])).toEqual({
    aiCategory: "filing",
    aiAction: "live-file-acknowledgement-clicked",
  });
});

test("seedAiIdentities copies contracts and named shell tokens", () => {
  const data: DashboardData = {
    provenance: "t",
    repos: [
      {
        repo: "wdesk_sdk",
        events: [
          event({ name: "About Workiva", legacy: ["ShellGenericAnalyticEventV2", "aboutWorkiva"] }),
          event({ name: "General Experience Loading", legacy: ["GeneralExperienceLoadingEventV2"] }),
          event({ name: "Shell Generic Analytic", legacy: ["ShellGenericAnalyticEventV2"] }),
        ],
        counts: {},
        total: 3,
        live: 0,
        volume30: 0,
        sources: [],
        prs: [],
        inv_mapped: 0,
        inv_unmapped: 0,
      },
    ],
  };
  const seeded = seedAiIdentities(data);
  const byName = Object.fromEntries(seeded.repos[0]!.events.map((e) => [e.name, e]));
  expect(byName["About Workiva"]).toMatchObject({
    aiCategory: "shell",
    aiAction: "generic-analytic",
    aiEvent: "aboutWorkiva",
  });
  expect(byName["General Experience Loading"]).toMatchObject({
    aiCategory: "general",
    aiAction: "experience-loading",
  });
  const remainder = contractFor("Shell Generic Analytic")!;
  expect(byName["Shell Generic Analytic"]!.aiEventExclude).toEqual(remainder.aiEventExclude);
  expect(byName["Shell Generic Analytic"]!.aiEvent).toBeUndefined();
});

test("seedAiIdentities does not copy wdesk_sdk contracts onto other repos", () => {
  const data: DashboardData = {
    provenance: "t",
    repos: [
      {
        repo: "admin_client",
        events: [
          event({ name: "Create Workspace", legacy: ["WorkspaceCreateEventV4"] }),
        ],
        counts: {},
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
  const seeded = seedAiIdentities(data);
  const ev = seeded.repos[0]!.events[0]!;
  expect(ev.aiCategory).toBe("workspace");
  expect(ev.aiAction).toBe("create");
  expect(ev.aiEvent).toBeUndefined();
});

test("aiCountForEvent matches named, dedicated, and remainder cells without overlap", () => {
  const cells: AiCell[] = [
    { category: "shell", action: "generic-analytic", event: "aboutWorkiva", count: 10 },
    { category: "shell", action: "generic-analytic", event: "experienceAlreadyOpen", count: 5 },
    { category: "shell", action: "generic-analytic", event: "progressItem.high", count: 7 },
    { category: "shell", action: "generic-analytic", event: "otherThing", count: 3 },
    { category: "general", action: "experience-loading", event: null, count: 100 },
  ];
  expect(
    aiCountForEvent(
      event({ aiCategory: "shell", aiAction: "generic-analytic", aiEvent: "aboutWorkiva" }),
      cells,
    ),
  ).toBe(10);
  expect(
    aiCountForEvent(event({ aiCategory: "general", aiAction: "experience-loading" }), cells),
  ).toBe(100);
  expect(
    aiCountForEvent(
      event({
        aiCategory: "shell",
        aiAction: "generic-analytic",
        aiEventExclude: ["aboutWorkiva", "experienceAlreadyOpen"],
      }),
      cells,
    ),
  ).toBe(3);
  expect(aiCountForEvent(event(), cells)).toBeNull();
});

test("applyHomepageVolumes fills Amp/AI totals and does not let AI change status", () => {
  const data: DashboardData = {
    provenance: "t",
    repos: [
      {
        repo: "wdesk_sdk",
        events: [
          event({
            name: "About Workiva",
            status: "missing",
            v365: 0,
            aiCategory: "shell",
            aiAction: "generic-analytic",
            aiEvent: "aboutWorkiva",
          }),
          event({ name: "No Identity", status: "live", v30: 9 }),
          event({
            name: "AI Only",
            status: "missing",
            aiCategory: "ai-only",
            aiAction: "clicked",
          }),
        ],
        counts: { live: 1, missing: 2 },
        total: 3,
        live: 1,
        volume30: 9,
        sources: [],
        prs: [],
        inv_mapped: 0,
        inv_unmapped: 0,
      },
    ],
  };
  const amp = new Map([["About Workiva", 4]]);
  const cells: AiCell[] = [
    { category: "shell", action: "generic-analytic", event: "aboutWorkiva", count: 40 },
    { category: "ai-only", action: "clicked", event: null, count: 12 },
  ];
  const out = applyHomepageVolumes(
    data,
    amp,
    cells,
    new Map(),
    new Map(),
    "2026-08-24",
    "2026-08-26T16:00:00.000Z",
  );
  const about = out.repos[0]!.events[0]!;
  const none = out.repos[0]!.events[1]!;
  const aiOnly = out.repos[0]!.events[2]!;
  expect(about.v30).toBe(4);
  expect(about.status).toBe("live");
  expect(about.ai30).toBe(40);
  expect(none.v30).toBe(0);
  expect(none.status).toBe("stale");
  expect(none.ai30).toBeNull();
  expect(aiOnly.v30).toBe(0);
  expect(aiOnly.ai30).toBe(12);
  expect(aiOnly.status).not.toBe("live");
  expect(out.repos[0]!.volume30).toBe(4);
  expect(out.repos[0]!.volume30Ai).toBe(52);
  expect(out.volumeAsOf).toBe("2026-08-24");
  expect(out.volumeWindowDays).toBe(30);
  expect(out.volumeRefreshedAt).toBe("2026-08-26T16:00:00.000Z");
});

test("applyHomepageVolumes attaches daily series only for top-5 live preview names", () => {
  const data: DashboardData = {
    provenance: "t",
    repos: [
      {
        repo: "wdesk_sdk",
        events: [
          event({
            name: "A",
            status: "live",
            aiCategory: "general",
            aiAction: "experience-loading",
          }),
          event({ name: "B", status: "missing" }),
        ],
        counts: { live: 1 },
        total: 2,
        live: 1,
        volume30: 0,
        sources: [],
        prs: [],
        inv_mapped: 0,
        inv_unmapped: 0,
      },
    ],
  };
  const series = Array.from({ length: 30 }, () => 1);
  const out = applyHomepageVolumes(
    data,
    new Map([["A", 10]]),
    [{ category: "general", action: "experience-loading", event: null, count: 8 }],
    new Map([["A", series]]),
    new Map([["A", series]]),
    "2026-08-24",
    "2026-08-26T16:00:00.000Z",
  );
  expect(out.repos[0]!.events[0]!.series30).toEqual(series);
  expect(out.repos[0]!.events[0]!.aiSeries30).toEqual(series);
  expect(out.repos[0]!.events[1]!.series30).toBeUndefined();
  expect(out.repos[0]!.events[1]!.aiSeries30).toBeUndefined();
});
