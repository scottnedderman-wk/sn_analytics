import { expect, test } from "bun:test";
import type { MigrationEvent } from "./model";
import { explainCounts, explainEvent, explainSummary, reasonText } from "./volumeExplain";

function event(over: Partial<MigrationEvent> = {}): MigrationEvent {
  return {
    name: "Expand",
    legacy: [],
    status: "live",
    v30: 1000,
    v365: 0,
    dev30: 0,
    merged: false,
    pr: null,
    amp_count: null,
    ss_error: "",
    queried: 0,
    aiCategory: "outline",
    aiAction: "expand",
    ai30: 2000,
    ...over,
  };
}

test("a shared App Intel identity explains the row when the combined volumes agree", () => {
  const expand = event();
  const collapse = event({ name: "Collapse", v30: 1000 });
  const reason = explainEvent(expand, [expand, collapse], null, 5);
  expect(reason).toEqual({ kind: "shared", others: ["Collapse"], combinedDiff: 0 });
  expect(reasonText(reason)).toBe("Shared with Collapse");
});

test("sharing that still misses tolerance stays unexplained until a single day accounts for it", () => {
  const expand = event({ v30: 100, ai30: 300 });
  const collapse = event({ name: "Collapse", v30: 100, ai30: 300 });
  const days = [
    { date: "2026-08-17", amp: 10, ai: 10 },
    { date: "2026-08-18", amp: 10, ai: 10 },
    { date: "2026-08-19", amp: 80, ai: 280 },
  ];
  expect(explainEvent(expand, [expand, collapse], null, 5).kind).toBe("unexplained");
  const reason = explainEvent(expand, [expand, collapse], days, 5);
  expect(reason).toEqual({ kind: "one-day", day: "2026-08-19" });
  expect(reasonText(reason)).toBe("Most of the gap is 2026-08-19");
});

test("zero Amplitude with App Intel volume is its own reason", () => {
  const row = event({ v30: 0, ai30: 400, aiCategory: undefined, aiAction: undefined });
  const reason = explainEvent(row, [row], null, 5);
  expect(reason.kind).toBe("no-amplitude");
  expect(reasonText(reason)).toBe("No Amplitude volume");
});

test("summary counts the rows that still need analysis", () => {
  const shared = explainEvent(event(), [event(), event({ name: "Collapse" })], null, 5);
  const missing = explainEvent(event({ name: "Cancel", v30: 0, ai30: 10 }), [], null, 5);
  const open = explainEvent(event({ name: "Remove", aiCategory: "outline", aiAction: "remove", v30: 100, ai30: 140 }), [], null, 5);
  const counts = explainCounts([shared, missing, open]);
  expect(counts).toEqual({ shared: 1, oneDay: 0, noAmplitude: 1, unexplained: 1 });
  expect(explainSummary(counts)).toBe("1 shared identity · 1 no Amplitude volume · 1 unexplained");
});
