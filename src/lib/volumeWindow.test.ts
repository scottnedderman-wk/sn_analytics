import { expect, test } from "bun:test";
import {
  DEFAULT_VOLUME_WINDOW,
  canApplyWindow,
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
  expect(canApplyWindow(applied, applied)).toBe(false);
  expect(canApplyWindow({ start: "2026-08-17", end: "2026-08-20" }, applied)).toBe(true);
  expect(canApplyWindow({ start: "2026-08-18", end: "2026-08-17" }, applied)).toBe(false);
  expect(canApplyWindow({ start: "", end: "2026-08-18" }, applied)).toBe(false);
});
