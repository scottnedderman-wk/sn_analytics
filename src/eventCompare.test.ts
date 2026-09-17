import { expect, test } from "bun:test";
import {
  closedDayWindow,
  compareRowFromCache,
  compareRowFromContract,
  compositeScore,
  contractFor,
  contractsForRepo,
  formatScoreTitle,
  overlapVolume,
  populatedScore,
  scoreParts,
  typesCompatible,
  volumeScore,
  type CompareSnapshot,
  type ScoreParts,
  type SnapshotField,
} from "./eventCompare";

test("closedDayWindow is last 7 UTC days ending 2 days ago", () => {
  expect(closedDayWindow(new Date("2026-08-26T16:00:00Z"))).toEqual({
    start: "2026-08-18",
    end: "2026-08-24",
  });
});

test("overlapVolume sums only days present on both sides", () => {
  expect(overlapVolume([])).toBeNull();
  expect(
    overlapVolume([
      { date: "2026-09-08", ai: 2210665, amp: 2149377 },
      { date: "2026-09-09", ai: 2344244, amp: 2276995 },
      { date: "2026-09-10", ai: 222574, amp: 2187402 },
      { date: "2026-09-11", ai: null, amp: 1000 },
    ]),
  ).toEqual({ ai: 4777483, amp: 6613774 });
});

test("typesCompatible matches spec rules", () => {
  expect(typesCompatible("DATE", "DATE", "event_time")).toBe(true);
  expect(typesCompatible("TIMESTAMP_NTZ", "DATE", "event_time")).toBe(true);
  expect(typesCompatible("VARCHAR ISO", "DATE", "event_time")).toBe(true);
  expect(typesCompatible("VARCHAR", "VARCHAR", "user")).toBe(true);
  expect(typesCompatible("VARIANT INTEGER", "NUMBER", "duration")).toBe(true);
  expect(typesCompatible("VARCHAR", "VARCHAR", "environment")).toBe(true);
  expect(typesCompatible("BOOLEAN", "VARCHAR", "user")).toBe(false);
});

test("GEL contract is registered for wdesk_sdk", () => {
  const c = contractFor("General Experience Loading");
  expect(c?.repo).toBe("wdesk_sdk");
  expect(c?.aiTable).toBe("SILVER_PROD.ADMIN.USER_ANALYTIC");
  expect(c?.aiDateExpr).toBe("TRY_TO_TIMESTAMP(dimensions:timestamp::VARCHAR)::DATE");
  expect(c?.aiCategory).toBe("general");
  expect(c?.aiAction).toBe("experience-loading");
  expect(c?.fields).toHaveLength(8);
  expect(c?.fields.map((f) => f.key)).toEqual([
    "event_time",
    "user",
    "organization",
    "workspace",
    "duration",
    "environment",
    "page_url",
    "host",
  ]);
  expect(c?.fields.find((f) => f.key === "user")).toMatchObject({
    aiColumn: "dimensions:user_resource_id",
    ampColumn: "user_resource_id",
  });
  expect(c?.fields.find((f) => f.key === "page_url")).toMatchObject({
    aiColumn: "dimensions:url",
    ampColumn: "page_url",
  });
  expect(c?.fields.find((f) => f.key === "host")).toMatchObject({
    aiColumn: "dimensions:host",
    ampColumn: "page_domain",
  });
  expect(c?.omitted.map((o) => o.name)).toEqual([
    "experience_name vs experienceName",
    "session_id",
    "page_location",
    "page_path",
  ]);
  expect(contractsForRepo("wdesk_sdk").map((x) => x.eventName)).toContain("General Experience Loading");
  expect(contractsForRepo("wdesk_sdk").length).toBeGreaterThan(20);
  expect(contractsForRepo("w_outline")).toEqual([]);
});

test("named shell events filter dimensions:event", () => {
  const c = contractFor("Open Experience Already");
  expect(c?.aiCategory).toBe("shell");
  expect(c?.aiAction).toBe("generic-analytic");
  expect(c?.aiEvent).toBe("experienceAlreadyOpen");
  expect(c?.aiEventExclude).toBeUndefined();
});

test("Shell Generic Analytic excludes named shell events", () => {
  const c = contractFor("Shell Generic Analytic");
  expect(c?.aiCategory).toBe("shell");
  expect(c?.aiAction).toBe("generic-analytic");
  expect(c?.aiEvent).toBeUndefined();
  expect(c?.aiEventExclude).toContain("experienceAlreadyOpen");
  expect(c?.aiEventExclude).toContain("aboutWorkiva");
  expect(contractFor("Connect W Transport Web Socket")).toMatchObject({
    aiCategory: "wTransport",
    aiAction: "webSocket-connect",
  });
  expect(contractFor("General Experience Unloading")).toMatchObject({
    aiCategory: "general",
    aiAction: "experience-unloading",
  });
});

test("compositeScore averages non-pending parts only", () => {
  const pending: ScoreParts = { present: null, type: null, populated: null, volume: null };
  expect(compositeScore(pending)).toBeNull();
  expect(compositeScore({ present: 100, type: 100, populated: null, volume: null })).toBe(100);
  expect(compositeScore({ present: 100, type: 50, populated: 0, volume: 100 })).toBe(63);
});

test("formatScoreTitle lists pending parts", () => {
  expect(
    formatScoreTitle({ present: 100, type: 100, populated: null, volume: null }),
  ).toBe("Present 100% · Type 100% · Populated pending · Volume pending");
});

test("volumeScore matches spec", () => {
  expect(volumeScore(null, 10)).toBeNull();
  expect(volumeScore(10, null)).toBeNull();
  expect(volumeScore(0, 0)).toBe(100);
  expect(volumeScore(0, 10)).toBe(0);
  expect(volumeScore(80, 100)).toBe(80);
});

test("populatedScore needs fills on both sides", () => {
  const fields: SnapshotField[] = [
    {
      key: "user",
      aiColumn: "user_resource_id",
      aiType: "VARCHAR",
      ampColumn: "user_resource_id",
      ampType: "VARCHAR",
      present: true,
      typeCompatible: true,
      aiFill: 0.9,
      ampFill: 0.9,
    },
    {
      key: "organization",
      aiColumn: "organization_id",
      aiType: "VARCHAR",
      ampColumn: "organization_id",
      ampType: "VARCHAR",
      present: true,
      typeCompatible: true,
      aiFill: 0.4,
      ampFill: 0.9,
    },
  ];
  expect(populatedScore(fields)).toBe(50);
  expect(populatedScore(fields.map((f) => ({ ...f, aiFill: null })))).toBeNull();
});

test("scoreParts uses contract when snapshot is missing", () => {
  const parts = scoreParts(contractFor("General Experience Loading"), null);
  expect(parts.present).toBe(100);
  expect(parts.type).toBe(100);
  expect(parts.populated).toBeNull();
  expect(parts.volume).toBeNull();
  expect(compareRowFromContract("General Experience Loading")?.match).toBe(100);
  expect(compareRowFromContract("Clicked Save")).toBeNull();
});

test("compareRowFromCache scores volume from snapshot", () => {
  const snapshot: CompareSnapshot = {
    version: 1,
    window: { start: "2026-08-19", end: "2026-08-25" },
    volume: { ai: null, amp: 100 },
    fields: [],
  };
  const row = compareRowFromCache("General Experience Loading", snapshot, "2026-08-26T00:00:00.000Z", "timeout");
  expect(row.parts.present).toBe(100);
  expect(row.parts.volume).toBeNull();
  expect(row.lastError).toBe("timeout");
  expect(row.match).toBe(100);
});
