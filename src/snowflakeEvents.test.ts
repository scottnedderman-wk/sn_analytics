import { expect, test } from "bun:test";
import { credsFromEnv, executeStatement, parseArgs, SNOWFLAKE_ACCOUNT_URL } from "./snowflakeEvents";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

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

test("executeStatement POSTs SQL and parses data rows", async () => {
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
    expect(String(input)).toBe(`${SNOWFLAKE_ACCOUNT_URL}/api/v2/statements`);
    expect(init?.method).toBe("POST");
    const headers = new Headers(init?.headers);
    expect(headers.get("Authorization")).toBe("Bearer tok");
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.get("Accept")).toBe("application/json");
    expect(JSON.parse(String(init?.body))).toEqual({
      statement: "SELECT 1",
      warehouse: "PROD_WH",
      database: "GOLD_PROD",
      schema: "MARTS",
      role: "TECH_ANALYST",
      timeout: 120,
    });
    return jsonResponse(200, { data: [["Clicked Save", "12"]] });
  };
  expect(await executeStatement("SELECT 1", { pat: "tok" }, { fetchImpl })).toEqual([["Clicked Save", "12"]]);
});

test("executeStatement throws auth/permission on 401", async () => {
  const fetchImpl = async () => jsonResponse(401, { message: "invalid token" });
  expect(executeStatement("SELECT 1", { pat: "tok" }, { fetchImpl })).rejects.toThrow("401 auth/permission");
});

test("executeStatement throws Snowflake message on statement failure", async () => {
  const fetchImpl = async () =>
    jsonResponse(422, { code: "001003", message: "SQL compilation error: Object does not exist" });
  expect(executeStatement("SELECT 1", { pat: "tok" }, { fetchImpl })).rejects.toThrow(
    "422 SQL compilation error: Object does not exist",
  );
});
