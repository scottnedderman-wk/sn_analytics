import { expect, test } from "bun:test";
import { credsFromEnv, parseArgs } from "./snowflakeEvents";

test("credsFromEnv reads SNOWFLAKE_PAT", () => {
  expect(credsFromEnv({ SNOWFLAKE_PAT: " tok " })).toEqual({ pat: "tok" });
});

test("credsFromEnv throws when PAT is missing", () => {
  expect(() => credsFromEnv({})).toThrow("Set SNOWFLAKE_PAT in .env");
});

test("parseArgs accepts one app name", () => {
  expect(parseArgs(["bun", "scripts/snowflake-events.ts", "w_outline"])).toEqual({ app: "w_outline" });
});

test("parseArgs rejects missing or extra args", () => {
  expect(() => parseArgs(["bun", "scripts/snowflake-events.ts"])).toThrow(
    "Usage: bun run snowflake-events -- <app>",
  );
  expect(() => parseArgs(["bun", "scripts/snowflake-events.ts", "a", "b"])).toThrow(
    "Usage: bun run snowflake-events -- <app>",
  );
});
