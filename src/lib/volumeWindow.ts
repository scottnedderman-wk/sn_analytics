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

export function canApplyWindow(draft: DayWindow, applied: DayWindow): boolean {
  if (!draft.start || !draft.end) return false;
  if (draft.start > draft.end) return false;
  return draft.start !== applied.start || draft.end !== applied.end;
}
