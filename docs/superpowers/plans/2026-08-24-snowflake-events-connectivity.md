# Snowflake Events Connectivity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `bun run snowflake-events -- w_outline` that authenticates to Snowflake with `SNOWFLAKE_PAT` and prints session identity plus last-7-day `source_event_type` counts from `fct_amplitude_events`.

**Architecture:** Thin CLI in `scripts/snowflake-events.ts` calls testable helpers in `src/snowflakeEvents.ts`. The library `fetch`es the Snowflake SQL API (`POST /api/v2/statements`, poll `GET` on HTTP 202). Tests inject a fake `fetch` (and a fake clock for timeout). No SDK, no live Snowflake in `bun test`.

**Tech Stack:** Bun, TypeScript, `bun:test`, global `fetch`, Snowflake SQL API v2.

## Global Constraints

- Use Bun, not Node/npm/vite; `bun test` for tests; Bun loads `.env` automatically (no dotenv)
- Account URL `https://lec27990.us-east-1.snowflakecomputing.com`; SQL API `POST /api/v2/statements`
- Auth `Authorization: Bearer <SNOWFLAKE_PAT>`; never log the token; never commit `.env`
- Warehouse `PROD_WH`, database `GOLD_PROD`, schema `MARTS`, role `TECH_ANALYST`, statement timeout `120`
- Request headers always include `Content-Type: application/json` and `Accept: application/json`
- POST JSON body fields: `statement`, `warehouse`, `database`, `schema`, `role`, `timeout`
- `w_outline` is a required positional arg and is not used in SQL in this slice
- No `snowflake-sdk`, no key-pair JWT, no Amplitude comparison, no dashboard writes
- Tests must not call the network
- Only stage Snowflake files in commits (this workspace may have unrelated dashboard changes)
- Spec: `docs/superpowers/specs/2026-08-24-snowflake-events-connectivity-design.md`

## File map

| File | Responsibility |
|---|---|
| `src/snowflakeEvents.ts` | Creds, args, SQL API client, session + event-count queries, stdout formatters |
| `src/snowflakeEvents.test.ts` | Fake-`fetch` unit tests |
| `scripts/snowflake-events.ts` | CLI main |
| `package.json` | `snowflake-events` script |

---

### Task 1: Creds and CLI args

**Files:**
- Create: `src/snowflakeEvents.ts`
- Test: `src/snowflakeEvents.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `export type SnowflakeCreds = { pat: string }`
  - `export function credsFromEnv(env?: { SNOWFLAKE_PAT?: string }): SnowflakeCreds`
  - `export function parseArgs(argv: string[]): { app: string }` — `argv` is Bun-style (`[runtime, script, ...positionals]`). Exactly one positional required.

- [ ] **Step 1: Write the failing test**

Create `src/snowflakeEvents.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/snowflakeEvents.test.ts`

Expected: FAIL with `Cannot find module './snowflakeEvents'` (or similar)

- [ ] **Step 3: Write minimal implementation**

Create `src/snowflakeEvents.ts`:

```ts
export type SnowflakeCreds = { pat: string };

export function credsFromEnv(env: { SNOWFLAKE_PAT?: string } = process.env): SnowflakeCreds {
  const pat = env.SNOWFLAKE_PAT?.trim() ?? "";
  if (!pat) throw new Error("Set SNOWFLAKE_PAT in .env");
  return { pat };
}

export function parseArgs(argv: string[]): { app: string } {
  const positional = argv.slice(2);
  const app = positional[0]?.trim() ?? "";
  if (positional.length !== 1 || !app) {
    throw new Error("Usage: bun run snowflake-events -- <app>");
  }
  return { app };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/snowflakeEvents.test.ts`

Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/snowflakeEvents.ts src/snowflakeEvents.test.ts docs/superpowers/specs/2026-08-24-snowflake-events-connectivity-design.md docs/superpowers/plans/2026-08-24-snowflake-events-connectivity.md
git commit -m "$(cat <<'EOF'
Add Snowflake CLI arg and PAT helpers.

EOF
)"
```

If unrelated dashboard files are staged, unstage them first. Skip this commit only if the user asked not to commit.

---

### Task 2: SQL API execute — success and HTTP/Snowflake errors

**Files:**
- Modify: `src/snowflakeEvents.ts`
- Test: `src/snowflakeEvents.test.ts`

**Interfaces:**
- Consumes: `SnowflakeCreds` from Task 1
- Produces:
  - `export const SNOWFLAKE_ACCOUNT_URL = "https://lec27990.us-east-1.snowflakecomputing.com"`
  - `export type FetchImpl = (input: string | URL | Request, init?: RequestInit) => Promise<Response>`
  - `export type ExecuteDeps = { fetchImpl?: FetchImpl; now?: () => number; sleep?: (ms: number) => Promise<void> }`
  - `export async function executeStatement(sql: string, creds: SnowflakeCreds, deps?: ExecuteDeps): Promise<string[][]>`
  - POST `{SNOWFLAKE_ACCOUNT_URL}/api/v2/statements` with body `{ statement, warehouse: "PROD_WH", database: "GOLD_PROD", schema: "MARTS", role: "TECH_ANALYST", timeout: 120 }`
  - Parse Snowflake `data` by column position (cells are strings)
  - HTTP 401/403 → Error includes the status and `auth/permission`
  - Other HTTP non-success → Error includes status and `message` if present, else a body snippet
  - JSON body with `message` and no `data` (statement failure) → throw that Snowflake `message`

`ExecuteDeps` extends the spec's `fetchImpl?` with `now` / `sleep` so timeout tests do not wait 120s.

- [ ] **Step 1: Write the failing tests**

Update the import in `src/snowflakeEvents.test.ts` and append:

```ts
import { credsFromEnv, executeStatement, parseArgs, SNOWFLAKE_ACCOUNT_URL } from "./snowflakeEvents";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

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
    "SQL compilation error: Object does not exist",
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/snowflakeEvents.test.ts`

Expected: FAIL with `executeStatement is not a function` or `does not export executeStatement`

- [ ] **Step 3: Write minimal implementation**

Append to `src/snowflakeEvents.ts` (keep Task 1 exports):

```ts
export const SNOWFLAKE_ACCOUNT_URL = "https://lec27990.us-east-1.snowflakecomputing.com";

const STATEMENTS_URL = `${SNOWFLAKE_ACCOUNT_URL}/api/v2/statements`;

export type FetchImpl = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type ExecuteDeps = {
  fetchImpl?: FetchImpl;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

type SnowflakeStatementResponse = {
  data?: string[][];
  message?: string;
  statementHandle?: string;
};

async function readJson(res: Response): Promise<{ json: SnowflakeStatementResponse; snippet: string }> {
  const text = await res.text();
  const snippet = text.slice(0, 200);
  try {
    return { json: JSON.parse(text) as SnowflakeStatementResponse, snippet };
  } catch {
    return { json: {}, snippet };
  }
}

function throwHttpError(status: number, json: SnowflakeStatementResponse, snippet: string): never {
  if (status === 401 || status === 403) {
    throw new Error(`${status} auth/permission`);
  }
  if (json.message) throw new Error(json.message);
  throw new Error(`${status} ${snippet}`);
}

export async function executeStatement(
  sql: string,
  creds: SnowflakeCreds,
  deps: ExecuteDeps = {},
): Promise<string[][]> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const res = await fetchImpl(STATEMENTS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${creds.pat}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      statement: sql,
      warehouse: "PROD_WH",
      database: "GOLD_PROD",
      schema: "MARTS",
      role: "TECH_ANALYST",
      timeout: 120,
    }),
  });
  const { json, snippet } = await readJson(res);
  if (res.status === 202) {
    throw new Error("Snowflake statement timed out");
  }
  if (!res.ok || json.data == null) {
    throwHttpError(res.status, json, snippet);
  }
  return json.data;
}
```

The `202` branch throwing timeout is a stub so this compiles; Task 3 replaces it with polling.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/snowflakeEvents.test.ts`

Expected: PASS (previous tests plus the three new ones)

- [ ] **Step 5: Commit**

```bash
git add src/snowflakeEvents.ts src/snowflakeEvents.test.ts
git commit -m "$(cat <<'EOF'
Add Snowflake SQL API statement execution.

EOF
)"
```

---

### Task 3: SQL API 202 poll and timeout

**Files:**
- Modify: `src/snowflakeEvents.ts` (`executeStatement` only)
- Test: `src/snowflakeEvents.test.ts`

**Interfaces:**
- Consumes: `executeStatement`, `ExecuteDeps`, `SNOWFLAKE_ACCOUNT_URL` from Task 2
- Produces: same `executeStatement` signature. HTTP 202 → `GET {SNOWFLAKE_ACCOUNT_URL}/api/v2/statements/{statementHandle}` with the same Bearer / Accept headers until `data` arrives, the statement fails, or 120s elapses. Poll interval 1s via `deps.sleep` (default `Bun.sleep`). Deadline via `deps.now` (default `Date.now`). Timeout error: `Snowflake statement timed out`.

- [ ] **Step 1: Write the failing tests**

Add `FetchImpl` to the import list. Append:

```ts
test("executeStatement polls GET after 202 until data arrives", async () => {
  const calls: Array<{ url: string; method: string }> = [];
  const fetchImpl: FetchImpl = async (input, init) => {
    calls.push({ url: String(input), method: init?.method ?? "GET" });
    if (calls.length === 1) {
      return jsonResponse(202, { statementHandle: "abc-handle" });
    }
    const headers = new Headers(init?.headers);
    expect(headers.get("Authorization")).toBe("Bearer tok");
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
  const fetchImpl = async () => jsonResponse(202, { statementHandle: "h" });
  expect(
    executeStatement("SELECT 1", { pat: "tok" }, {
      fetchImpl,
      now: () => t,
      sleep: async () => {
        t += 121_000;
      },
    }),
  ).rejects.toThrow("Snowflake statement timed out");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/snowflakeEvents.test.ts`

Expected: FAIL — 202 poll test throws `Snowflake statement timed out` (stub) instead of returning rows

- [ ] **Step 3: Replace the 202 stub with polling**

In `src/snowflakeEvents.ts`, replace `executeStatement` and keep `readJson` / `throwHttpError` / `STATEMENTS_URL` from Task 2. Add:

```ts
const POLL_MS = 1_000;
const TIMEOUT_MS = 120_000;

async function statementResult(
  res: Response,
  creds: SnowflakeCreds,
  deps: ExecuteDeps,
): Promise<string[][]> {
  const { json, snippet } = await readJson(res);
  if (res.status === 202) {
    const handle = json.statementHandle;
    if (!handle) throw new Error(`202 ${snippet}`);
    return pollStatement(handle, creds, deps);
  }
  if (!res.ok || json.data == null) {
    throwHttpError(res.status, json, snippet);
  }
  return json.data;
}

async function pollStatement(handle: string, creds: SnowflakeCreds, deps: ExecuteDeps): Promise<string[][]> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms: number) => Bun.sleep(ms));
  const deadline = now() + TIMEOUT_MS;
  const url = `${STATEMENTS_URL}/${handle}`;
  for (;;) {
    if (now() >= deadline) throw new Error("Snowflake statement timed out");
    await sleep(POLL_MS);
    const res = await fetchImpl(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${creds.pat}`,
        Accept: "application/json",
      },
    });
    const { json, snippet } = await readJson(res);
    if (res.status === 202) continue;
    if (!res.ok || json.data == null) {
      throwHttpError(res.status, json, snippet);
    }
    return json.data;
  }
}

export async function executeStatement(
  sql: string,
  creds: SnowflakeCreds,
  deps: ExecuteDeps = {},
): Promise<string[][]> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const res = await fetchImpl(STATEMENTS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${creds.pat}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      statement: sql,
      warehouse: "PROD_WH",
      database: "GOLD_PROD",
      schema: "MARTS",
      role: "TECH_ANALYST",
      timeout: 120,
    }),
  });
  return statementResult(res, creds, deps);
}
```

Do not change the POST body fields from Task 2.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/snowflakeEvents.test.ts`

Expected: PASS including the two poll tests

- [ ] **Step 5: Commit**

```bash
git add src/snowflakeEvents.ts src/snowflakeEvents.test.ts
git commit -m "$(cat <<'EOF'
Poll Snowflake SQL API statements until rows arrive.

EOF
)"
```

---

### Task 4: Session info and 7-day event counts

**Files:**
- Modify: `src/snowflakeEvents.ts`
- Test: `src/snowflakeEvents.test.ts`

**Interfaces:**
- Consumes: `executeStatement(sql, creds, deps)`, `SnowflakeCreds`, `ExecuteDeps` from Tasks 1–3
- Produces:
  - `export const SESSION_SQL = "SELECT CURRENT_USER() AS current_user, CURRENT_ROLE() AS current_role, CURRENT_WAREHOUSE() AS current_warehouse"`
  - `export const EVENT_COUNTS_SQL` — exact spec SQL below
  - `export type SessionInfo = { user: string; role: string; warehouse: string }`
  - `export type EventCount = { sourceEventType: string; eventCount: number }`
  - `export async function sessionInfo(creds: SnowflakeCreds, deps?: ExecuteDeps): Promise<SessionInfo>`
  - `export async function eventCountsLast7d(creds: SnowflakeCreds, deps?: ExecuteDeps): Promise<EventCount[]>`
  - `export function formatSession(info: SessionInfo): string` → `user=<user> role=<role> warehouse=<warehouse>`
  - `export function formatEventCounts(rows: EventCount[]): string` → one `<sourceEventType>\t<eventCount>` line per row, integer counts, no header

- [ ] **Step 1: Write the failing tests**

Extend the import and append:

```ts
import {
  EVENT_COUNTS_SQL,
  eventCountsLast7d,
  formatEventCounts,
  formatSession,
  SESSION_SQL,
  sessionInfo,
} from "./snowflakeEvents";

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/snowflakeEvents.test.ts`

Expected: FAIL with missing `SESSION_SQL` / `sessionInfo` exports

- [ ] **Step 3: Write minimal implementation**

Append to `src/snowflakeEvents.ts`:

```ts
export const SESSION_SQL =
  "SELECT CURRENT_USER() AS current_user, CURRENT_ROLE() AS current_role, CURRENT_WAREHOUSE() AS current_warehouse";

export const EVENT_COUNTS_SQL = `SELECT source_event_type, COUNT(*) AS event_count
FROM gold_prod.marts.fct_amplitude_events
WHERE event_date BETWEEN DATEADD(day, -7, CURRENT_DATE()) AND CURRENT_DATE()
  AND is_amplitude_generated_event = FALSE
GROUP BY source_event_type
ORDER BY event_count DESC
LIMIT 50`;

export type SessionInfo = { user: string; role: string; warehouse: string };
export type EventCount = { sourceEventType: string; eventCount: number };

export async function sessionInfo(creds: SnowflakeCreds, deps: ExecuteDeps = {}): Promise<SessionInfo> {
  const rows = await executeStatement(SESSION_SQL, creds, deps);
  const row = rows[0];
  if (!row || row[0] == null || row[1] == null || row[2] == null) {
    throw new Error("Snowflake session query returned no row");
  }
  return { user: row[0], role: row[1], warehouse: row[2] };
}

export async function eventCountsLast7d(creds: SnowflakeCreds, deps: ExecuteDeps = {}): Promise<EventCount[]> {
  const rows = await executeStatement(EVENT_COUNTS_SQL, creds, deps);
  return rows.map((row) => ({
    sourceEventType: row[0] ?? "",
    eventCount: Number.parseInt(row[1] ?? "0", 10) || 0,
  }));
}

export function formatSession(info: SessionInfo): string {
  return `user=${info.user} role=${info.role} warehouse=${info.warehouse}`;
}

export function formatEventCounts(rows: EventCount[]): string {
  return rows.map((r) => `${r.sourceEventType}\t${r.eventCount}`).join("\n");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/snowflakeEvents.test.ts`

Expected: PASS all tests in the file

- [ ] **Step 5: Commit**

```bash
git add src/snowflakeEvents.ts src/snowflakeEvents.test.ts
git commit -m "$(cat <<'EOF'
Query Snowflake session identity and 7-day event counts.

EOF
)"
```

---

### Task 5: CLI script and package.json

**Files:**
- Create: `scripts/snowflake-events.ts`
- Modify: `package.json` (add script only)

**Interfaces:**
- Consumes: `parseArgs`, `credsFromEnv`, `sessionInfo`, `eventCountsLast7d`, `formatSession`, `formatEventCounts` from Tasks 1 and 4
- Produces: `package.json` script `"snowflake-events": "bun scripts/snowflake-events.ts"`
- CLI: `parseArgs(Bun.argv)` → `credsFromEnv()` → print `formatSession(await sessionInfo(creds))` → print `formatEventCounts(await eventCountsLast7d(creds))` if any rows → exit 0. On throw: message to stderr, exit 1. Do not log the PAT.

- [ ] **Step 1: Add the package script**

In `package.json` `scripts`, add after `amplitude-refresh-30d`:

```json
"snowflake-events": "bun scripts/snowflake-events.ts"
```

Leave existing scripts unchanged.

- [ ] **Step 2: Write the CLI**

Create `scripts/snowflake-events.ts`:

```ts
#!/usr/bin/env bun
import {
  credsFromEnv,
  eventCountsLast7d,
  formatEventCounts,
  formatSession,
  parseArgs,
  sessionInfo,
} from "../src/snowflakeEvents";

try {
  parseArgs(Bun.argv);
  const creds = credsFromEnv();
  const session = await sessionInfo(creds);
  console.log(formatSession(session));
  const counts = await eventCountsLast7d(creds);
  if (counts.length > 0) console.log(formatEventCounts(counts));
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
```

- [ ] **Step 3: Run unit tests (still no network)**

Run: `bun test src/snowflakeEvents.test.ts`

Expected: PASS

- [ ] **Step 4: Run the CLI against live Snowflake**

Run: `bun run snowflake-events -- w_outline`

Expected:
- Exit 0
- First line: `user=<your user> role=TECH_ANALYST warehouse=PROD_WH` (role/warehouse as Snowflake returns them)
- Following lines: `source_event_type` tab integer counts, up to 50 rows
- If auth fails: stderr contains `401 auth/permission` or `403 auth/permission`, exit 1 — stop and report rather than changing auth design

- [ ] **Step 5: Commit**

```bash
git add scripts/snowflake-events.ts package.json
git commit -m "$(cat <<'EOF'
Add snowflake-events CLI for connectivity checks.

EOF
)"
```
