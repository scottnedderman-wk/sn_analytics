import { describe, expect, test } from "bun:test";
import { normalizeBasePath, withBase } from "./basePath";

describe("normalizeBasePath", () => {
  test("empty values mean no prefix", () => {
    expect(normalizeBasePath(undefined)).toBe("");
    expect(normalizeBasePath("")).toBe("");
    expect(normalizeBasePath("/")).toBe("");
  });

  test("adds leading slash and strips trailing slash", () => {
    expect(normalizeBasePath("s/sn-analytics")).toBe("/s/sn-analytics");
    expect(normalizeBasePath("/s/sn-analytics/")).toBe("/s/sn-analytics");
  });
});

describe("withBase", () => {
  test("prefixes the path", () => {
    expect(withBase("/api/x", "/s/sn-analytics")).toBe("/s/sn-analytics/api/x");
    expect(withBase("/api/x", "")).toBe("/api/x");
  });
});
