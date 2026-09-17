import { expect, test } from "bun:test";
import { listenPort, SERVE_IDLE_TIMEOUT_SECONDS } from "./port";

test("defaults to 3000", () => {
  expect(listenPort({})).toBe(3000);
});

test("reads PORT", () => {
  expect(listenPort({ PORT: "80" })).toBe(80);
});

test("disables Bun idleTimeout so Snowflake refresh is not reset as Failed to fetch", async () => {
  expect(SERVE_IDLE_TIMEOUT_SECONDS).toBe(0);
  const src = await Bun.file(new URL("./index.tsx", import.meta.url)).text();
  expect(src).toContain("idleTimeout: SERVE_IDLE_TIMEOUT_SECONDS");
});
