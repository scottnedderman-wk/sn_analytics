import { expect, test } from "bun:test";
import {
  DEFAULT_VOLUME_WINDOW,
  canApplyWindow,
  eachUtcDate,
  parseDayWindow,
  windowHalfOpen,
} from "./volumeWindow";

test("default volume window is two inclusive UTC days ending 2026-08-18", () => {
  expect(DEFAULT_VOLUME_WINDOW).toEqual({ start: "2026-08-17", end: "2026-08-18" });
});

test("windowHalfOpen is start-of-start through end-of-end (exclusive next day)", () => {
  expect(windowHalfOpen({ start: "2026-08-17", end: "2026-08-18" })).toEqual({
    start: "2026-08-17T00:00:00.000Z",
    endExclusive: "2026-08-19T00:00:00.000Z",
  });
});

test("canApplyWindow requires a change and start <= end", () => {
  const applied = { start: "2026-08-17", end: "2026-08-18" };
  expect(canApplyWindow(applied, null)).toBe(true);
  expect(canApplyWindow(applied, applied)).toBe(false);
  expect(canApplyWindow({ start: "2026-08-17", end: "2026-08-20" }, applied)).toBe(true);
  expect(canApplyWindow({ start: "2026-08-18", end: "2026-08-17" }, applied)).toBe(false);
  expect(canApplyWindow({ start: "", end: "2026-08-18" }, applied)).toBe(false);
  expect(canApplyWindow({ start: "", end: "2026-08-18" }, null)).toBe(false);
});

test("eachUtcDate lists inclusive UTC calendar days", () => {
  expect(eachUtcDate({ start: "2026-08-17", end: "2026-08-18" })).toEqual(["2026-08-17", "2026-08-18"]);
});

test("parseDayWindow accepts inclusive YYYY-MM-DD bounds", () => {
  expect(parseDayWindow({ start: "2026-08-17", end: "2026-08-18" })).toEqual({
    start: "2026-08-17",
    end: "2026-08-18",
  });
});

test("parseDayWindow rejects missing, malformed, or inverted dates", () => {
  expect(() => parseDayWindow(null)).toThrow("start and end dates are required");
  expect(() => parseDayWindow({ start: "08/17/2026", end: "2026-08-18" })).toThrow(
    "start and end must be YYYY-MM-DD",
  );
  expect(() => parseDayWindow({ start: "2026-08-18", end: "2026-08-17" })).toThrow(
    "start must be on or before end",
  );
});
