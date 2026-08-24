# Snowflake events connectivity — design

Date: 2026-08-24

## Goal

Add a Bun CLI that proves we can authenticate to Snowflake and read Amplitude event marts. This is the first slice of comparing Snowflake event volume to Amplitude / App Intel. `w_outline` is accepted as a required app argument but is not used in SQL yet.

```bash
bun run snowflake-events -- w_outline
```

## Non-goals

- Filtering by app (`w_outline`) in SQL
- Comparing Snowflake counts to Amplitude or App Intel
- Key-pair JWT / `snowflake-sdk`
- Writing files or updating the dashboard
- Live Snowflake calls in `bun test`

## Architecture

Same pattern as Amplitude refresh: `fetch` plus env creds, no SDK.

```
CLI (scripts/snowflake-events.ts)
        │  PAT from .env
        ▼
src/snowflakeEvents.ts
        │  POST /api/v2/statements
        ▼
Snowflake SQL API
  https://lec27990.us-east-1.snowflakecomputing.com
```

## Defaults (locked)

| Item | Value |
|---|---|
| Account URL | `https://lec27990.us-east-1.snowflakecomputing.com` |
| SQL API | `POST /api/v2/statements` |
| Auth | `Authorization: Bearer <SNOWFLAKE_PAT>` |
| Warehouse | `PROD_WH` |
| Database | `GOLD_PROD` |
| Schema | `MARTS` |
| Role | `TECH_ANALYST` |
| Statement timeout | `120` seconds |
| App arg | required positional; ignored by SQL in this slice |

## Components

### `src/snowflakeEvents.ts`

| Function | Responsibility |
|---|---|
| `credsFromEnv()` | Read `SNOWFLAKE_PAT`; throw if missing/blank |
| `parseArgs(argv)` | Require exactly one positional app name; throw usage error otherwise |
| `executeStatement(sql, creds, fetchImpl?)` | POST SQL with `Content-Type` and `Accept` `application/json`; poll on HTTP 202 until rows or timeout. Parse `data` by column position (Snowflake returns cells as strings). |
| `sessionInfo(creds, fetchImpl?)` | Run session SQL; return `{ user, role, warehouse }` |
| `eventCountsLast7d(creds, fetchImpl?)` | Run event-count SQL; return `{ sourceEventType, eventCount }[]` |

`fetchImpl` defaults to global `fetch` so tests can inject a fake.

### `scripts/snowflake-events.ts`

Thin main: `parseArgs(Bun.argv)` → `credsFromEnv()` → `sessionInfo()` → print one line → `eventCountsLast7d()` → print two-column rows → exit 0. Any thrown error is printed to stderr and the process exits 1.

### `package.json`

```json
"snowflake-events": "bun scripts/snowflake-events.ts"
```

## SQL (locked)

Session:

```sql
SELECT CURRENT_USER() AS current_user, CURRENT_ROLE() AS current_role, CURRENT_WAREHOUSE() AS current_warehouse
```

Event counts (fully qualified table, matching the original SQL API example):

```sql
SELECT source_event_type, COUNT(*) AS event_count
FROM gold_prod.marts.fct_amplitude_events
WHERE event_date BETWEEN DATEADD(day, -7, CURRENT_DATE()) AND CURRENT_DATE()
  AND is_amplitude_generated_event = FALSE
GROUP BY source_event_type
ORDER BY event_count DESC
LIMIT 50
```

## Data flow

1. Require one positional arg (`w_outline`). Missing/extra args → usage on stderr, exit 1.
2. Load `SNOWFLAKE_PAT` from `.env` (Bun loads `.env` automatically). Never log the token.
3. POST session SQL with body `{ statement, warehouse, database, schema, role, timeout }`.
4. Print: `user=<user> role=<role> warehouse=<warehouse>`
5. POST event-count SQL with the same context.
6. Print one line per row: `<source_event_type>\t<event_count>` with `event_count` parsed from the string cell to an integer. No header.
7. Exit 0. No files written.

If the POST returns HTTP 202, poll `GET /api/v2/statements/{statementHandle}` with the same Bearer token until the statement succeeds, fails, or the 120s timeout elapses. Poll interval: 1 second.

## Error handling

Throw (CLI catches → stderr + exit 1), no retries:

| Condition | Message includes |
|---|---|
| Missing/blank `SNOWFLAKE_PAT` | `Set SNOWFLAKE_PAT in .env` |
| Missing/extra CLI args | `Usage: bun run snowflake-events -- <app>` |
| HTTP 401 or 403 | status and `auth/permission` |
| Other HTTP non-success | status and response body snippet |
| Snowflake `message` / `code` indicating failure | Snowflake message |
| Poll exceeds 120s | `Snowflake statement timed out` |

## Testing

`src/snowflakeEvents.test.ts` uses a fake `fetch`. No network.

- `credsFromEnv` throws without `SNOWFLAKE_PAT`
- `parseArgs` accepts `w_outline` and rejects missing/extra args
- Session SQL and event-count SQL strings match this spec
- HTTP 200 JSON `data` rows parse to typed results
- HTTP 202 then a successful GET poll returns rows
- HTTP 401 throws with status
- Snowflake failure payload throws with the Snowflake message

## Out of scope follow-ups

Later slices (not this script): filter marts by app using `w_outline`, pull matching Amplitude counts, and diff within a tolerance against App Intel.
