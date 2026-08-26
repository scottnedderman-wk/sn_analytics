import { expect, test } from "bun:test";
import {
  closedDayWindow,
  compareRowFromCache,
  compareRowFromContract,
  compositeScore,
  contractFor,
  contractsForRepo,
  formatScoreTitle,
  populatedScore,
  scoreParts,
  typesCompatible,
  volumeScore,
  type CompareSnapshot,
  type ScoreParts,
  type SnapshotField,
} from "./eventCompare";

test("closedDayWindow is last 7 UTC days excluding today", () => {
  expect(closedDayWindow(new Date("2026-08-26T16:00:00Z"))).toEqual({
    start: "2026-08-19",
    end: "2026-08-25",
  });
});

test("typesCompatible matches spec rules", () => {
  expect(typesCompatible("DATE", "DATE", "event_time")).toBe(true);
  expect(typesCompatible("TIMESTAMP_NTZ", "DATE", "event_time")).toBe(true);
  expect(typesCompatible("VARCHAR", "VARCHAR", "user")).toBe(true);
  expect(typesCompatible("FLOAT", "NUMBER", "duration")).toBe(true);
  expect(typesCompatible("VARCHAR", "VARCHAR", "environment")).toBe(true);
  expect(typesCompatible("BOOLEAN", "VARCHAR", "user")).toBe(false);
});

test("GEL contract is registered for wdesk_sdk", () => {
  const c = contractFor("General Experience Loading");
  expect(c?.repo).toBe("wdesk_sdk");
  expect(c?.fields).toHaveLength(6);
  expect(contractsForRepo("wdesk_sdk").map((x) => x.eventName)).toEqual(["General Experience Loading"]);
  expect(contractsForRepo("w_outline")).toEqual([]);
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
