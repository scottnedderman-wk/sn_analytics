import { expect, test } from "bun:test";
import {
  credsFromEnv,
  EVENT_COUNTS_SQL,
  eventCountsLast7d,
  executeStatement,
  formatEventCounts,
  formatSession,
  parseArgs,
  SESSION_SQL,
  sessionInfo,
  SNOWFLAKE_ACCOUNT_URL,
  type FetchImpl,
} from "./snowflakeEvents";

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

test("executeStatement uses an override session for App Intel", async () => {
  const fetchImpl = async (_input: string | URL | Request, init?: RequestInit) => {
    expect(JSON.parse(String(init?.body))).toEqual({
      statement: "SELECT 1",
      warehouse: "PROD_SILVER_LARGE_DBT_WAREHOUSE",
      database: "SILVER_PROD",
      schema: "ADMIN",
      role: "TECH_ANALYST",
      timeout: 120,
    });
    return jsonResponse(200, { data: [["1"]] });
  };
  expect(
    await executeStatement("SELECT 1", { pat: "tok" }, {
      fetchImpl,
      session: {
        warehouse: "PROD_SILVER_LARGE_DBT_WAREHOUSE",
        database: "SILVER_PROD",
        schema: "ADMIN",
      },
    }),
  ).toEqual([["1"]]);
});

test("executeStatement fetches remaining partitions and concatenates rows", async () => {
  const urls: string[] = [];
  const fetchImpl: FetchImpl = async (input, init) => {
    urls.push(`${init?.method ?? "GET"} ${String(input)}`);
    if ((init?.method ?? "GET") === "POST") {
      return jsonResponse(200, {
        data: [["Clicked Save", "1"]],
        statementHandle: "h1",
        resultSetMetaData: { partitionInfo: [{}, {}] },
      });
    }
    return jsonResponse(200, { data: [["Clicked Open", "2"]] });
  };
  const rows = await executeStatement("SELECT 1", { pat: "tok" }, { fetchImpl });
  expect(rows).toEqual([
    ["Clicked Save", "1"],
    ["Clicked Open", "2"],
  ]);
  expect(urls[1]).toBe(`GET ${SNOWFLAKE_ACCOUNT_URL}/api/v2/statements/h1?partition=1`);
});

test("executeStatement throws auth/permission on 401", async () => {
  const fetchImpl = async () => jsonResponse(401, { message: "invalid token" });
  await expect(executeStatement("SELECT 1", { pat: "tok" }, { fetchImpl })).rejects.toThrow(
    "401 auth/permission",
  );
});

test("executeStatement throws Snowflake message on statement failure", async () => {
  const fetchImpl = async () =>
    jsonResponse(422, { code: "001003", message: "SQL compilation error: Object does not exist" });
  await expect(executeStatement("SELECT 1", { pat: "tok" }, { fetchImpl })).rejects.toThrow(
    "422 SQL compilation error: Object does not exist",
  );
});

test("executeStatement polls GET after 202 until data arrives", async () => {
  const calls: Array<{ url: string; method: string }> = [];
  const fetchImpl: FetchImpl = async (input, init) => {
    calls.push({ url: String(input), method: init?.method ?? "GET" });
    if (calls.length === 1) {
      return jsonResponse(202, { statementHandle: "abc-handle" });
    }
    const headers = new Headers(init?.headers);
    expect(headers.get("Authorization")).toBe("Bearer tok");
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.get("Accept")).toBe("application/json");
    return jsonResponse(200, { data: [["user1", "TECH_ANALYST", "PROD_WH"]] });
  };
  const rows = await executeStatement("SELECT 1", { pat: "tok" }, { fetchImpl, sleep: async () => {} });
  expect(rows).toEqual([["user1", "TECH_ANALYST", "PROD_WH"]]);
  expect(calls[1]).toEqual({
    url: `${SNOWFLAKE_ACCOUNT_URL}/api/v2/statements/abc-handle`,
    method: "GET",
  });
});

test("executeStatement times out when 202 never completes", async () => {
  let t = 0;
  let fetchCalls = 0;
  const fetchImpl = async () => {
    fetchCalls += 1;
    return jsonResponse(202, { statementHandle: "h" });
  };
  await expect(
    executeStatement("SELECT 1", { pat: "tok" }, {
      fetchImpl,
      now: () => t,
      sleep: async () => {
        t += 121_000;
      },
    }),
  ).rejects.toThrow("Snowflake statement timed out");
  expect(fetchCalls).toBe(1);
});

test("SESSION_SQL matches spec", () => {
  expect(SESSION_SQL).toBe(
    "SELECT CURRENT_USER() AS current_user, CURRENT_ROLE() AS current_role, CURRENT_WAREHOUSE() AS current_warehouse",
  );
});

test("EVENT_COUNTS_SQL matches spec", () => {
  expect(EVENT_COUNTS_SQL).toBe(
    `SELECT source_event_type, COUNT(*) AS event_count
FROM gold_prod.marts.fct_amplitude_events
WHERE event_date BETWEEN DATEADD(day, -7, CURRENT_DATE()) AND CURRENT_DATE()
  AND is_amplitude_generated_event = FALSE
GROUP BY source_event_type
ORDER BY event_count DESC
LIMIT 50`,
  );
});

test("sessionInfo maps the first row by position", async () => {
  const fetchImpl = async () => jsonResponse(200, { data: [["SNEDDERMAN", "TECH_ANALYST", "PROD_WH"]] });
  expect(await sessionInfo({ pat: "tok" }, { fetchImpl })).toEqual({
    user: "SNEDDERMAN",
    role: "TECH_ANALYST",
    warehouse: "PROD_WH",
  });
});

test("eventCountsLast7d parses event_count as an integer", async () => {
  const fetchImpl = async () =>
    jsonResponse(200, {
      data: [
        ["Clicked Save", "12"],
        ["Viewed Page", "3"],
      ],
    });
  expect(await eventCountsLast7d({ pat: "tok" }, { fetchImpl })).toEqual([
    { sourceEventType: "Clicked Save", eventCount: 12 },
    { sourceEventType: "Viewed Page", eventCount: 3 },
  ]);
});

test("formatters match CLI output", () => {
  expect(formatSession({ user: "U", role: "R", warehouse: "W" })).toBe("user=U role=R warehouse=W");
  expect(formatEventCounts([{ sourceEventType: "Clicked Save", eventCount: 12 }])).toBe("Clicked Save\t12");
});
