import { ymdUtc } from "./eventCompare";

export type DayWindow = { start: string; end: string };

/** Inclusive UTC calendar days: start of 2026-08-17 through end of 2026-08-18. */
export const DEFAULT_VOLUME_WINDOW: DayWindow = {
  start: "2026-08-17",
  end: "2026-08-18",
};

export function windowHalfOpen(window: DayWindow): { start: string; endExclusive: string } {
  const end = new Date(`${window.end}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 1);
  return {
    start: `${window.start}T00:00:00.000Z`,
    endExclusive: `${ymdUtc(end)}T00:00:00.000Z`,
  };
}

export function eachUtcDate(window: DayWindow): string[] {
  const dates: string[] = [];
  const cursor = new Date(`${window.start}T00:00:00Z`);
  const end = new Date(`${window.end}T00:00:00Z`);
  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

export function canApplyWindow(draft: DayWindow, applied: DayWindow | null): boolean {
  if (!draft.start || !draft.end) return false;
  if (draft.start > draft.end) return false;
  if (!applied) return true;
  return draft.start !== applied.start || draft.end !== applied.end;
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;

export function parseDayWindow(value: unknown): DayWindow {
  if (!value || typeof value !== "object") {
    throw new Error("start and end dates are required");
  }
  const start = "start" in value ? value.start : undefined;
  const end = "end" in value ? value.end : undefined;
  if (typeof start !== "string" || typeof end !== "string" || !YMD.test(start) || !YMD.test(end)) {
    throw new Error("start and end must be YYYY-MM-DD");
  }
  if (start > end) throw new Error("start must be on or before end");
  return { start, end };
}
