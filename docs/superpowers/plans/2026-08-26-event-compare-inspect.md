# Event Compare Inspect UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On `/app/:repo`, show a composite Match % per event, Refresh all / per-event refresh (Snowflake → SQLite cache), and an Inspect modal of safe-to-compare App Intel vs Amplitude fields. GEL is the first contracted event.

**Architecture:** Pure compare logic in `src/eventCompare.ts` (shared by client and server). SQLite cache in `src/eventCompareCache.ts`. Snowflake refresh in `src/eventCompareRefresh.ts` using existing `executeStatement`. HTTP routes on `Bun.serve`. `AppDetail` loads cache on page load only and opens `EventCompareModal` from memory.

**Tech Stack:** Bun, TypeScript, React 19, `bun:test`, `bun:sqlite`, existing Snowflake SQL API helper. No new npm packages. No live Snowflake in tests.

## Global Constraints

- Use Bun (`bun test`, `bun <file>`); Bun loads `.env` (no dotenv)
- Spec: `docs/superpowers/specs/2026-08-26-event-compare-inspect-design.md`
- Do not change Live / 30d volume / GitHub / header `% live` meaning
- Do not query Snowflake on page load or modal open
- Do not compare exact values, `experience_name` vs `experienceName`, or session IDs
- No `?inspect=` URL; modal only
- Closed-day window: last 7 UTC days excluding today
- Populated floor: non-null rate ≥ 50%
- Env map: `us`↔`production`, `eu`↔`prod-eu`, `apac`↔`prod-apac`; drop `ca`, null, `sandbox`
- Failed refresh keeps last good snapshot and sets `last_error`
- Tests must not call the network
- Only stage files for this feature; do not commit `.env`
- Commit after each task if the user has not forbidden commits for this work; skip commits if they asked not to commit

## File map

| File | Responsibility |
|---|---|
| `src/eventCompare.ts` | Types, GEL contract, window, type compatibility, scores, `compareRowFromCache`, `compareRowFromContract` |
| `src/eventCompare.test.ts` | Pure unit tests |
| `src/eventCompareCache.ts` | SQLite CRUD for `event_compare` |
| `src/eventCompareCache.test.ts` | Temp-db cache tests |
| `src/eventCompareRefresh.ts` | Snowflake volume/fill queries; write cache |
| `src/eventCompareRefresh.test.ts` | Fake-`fetch` refresh tests |
| `src/db.ts` | Create `event_compare` table in `openAppDatabase` |
| `src/db.test.ts` | Assert table exists |
| `src/index.tsx` | GET/POST compare routes |
| `src/ui.tsx` | `RefreshIcon` |
| `src/EventCompareModal.tsx` | Dialog |
| `src/EventCompareModal.test.ts` | `renderToString` assertions |
| `src/AppDetail.tsx` | Row Match/Refresh/Inspect, header Refresh all, overlay state |

---

### Task 1: Types, GEL contract, window, scores

**Files:**
- Create: `src/eventCompare.ts`
- Test: `src/eventCompare.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `export type FieldKey = "event_time" | "user" | "organization" | "workspace" | "duration" | "environment"`
  - `export type ScoreParts = { present: number | null; type: number | null; populated: number | null; volume: number | null }`
  - `export type ContractField = { key: FieldKey; label: string; aiColumn: string; aiType: string; ampColumn: string; ampType: string; present: boolean; typeCompatible: boolean }`
  - `export type EventContract = { eventName: string; repo: string; aiTable: string; ampEventType: string; fields: ContractField[]; omitted: Array<{ name: string; reason: string }>; ampEnvs: string[]; aiEnvs: string[] }`
  - `export type SnapshotField = { key: string; aiColumn: string; aiType: string; ampColumn: string; ampType: string; present: boolean; typeCompatible: boolean; aiFill: number | null; ampFill: number | null }`
  - `export type CompareSnapshot = { version: 1; window: { start: string; end: string }; volume: { ai: number | null; amp: number | null }; fields: SnapshotField[] }`
  - `export type CompareRow = { eventName: string; snapshot: CompareSnapshot | null; refreshedAt: string | null; lastError: string | null; parts: ScoreParts; match: number | null }`
  - `export const POPULATED_FLOOR = 0.5`
  - `export function ymdUtc(d: Date): string`
  - `export function closedDayWindow(now?: Date): { start: string; end: string }`
  - `export function typesCompatible(aiType: string, ampType: string, key: FieldKey): boolean`
  - `export function contractFor(eventName: string): EventContract | undefined`
  - `export function contractsForRepo(repo: string): EventContract[]`
  - `export function compositeScore(parts: ScoreParts): number | null`
  - `export function formatScoreTitle(parts: ScoreParts): string`
  - `export function volumeScore(ai: number | null, amp: number | null): number | null`
  - `export function populatedScore(fields: SnapshotField[]): number | null`
  - `export function presentScore(fields: { present: boolean }[]): number | null`
  - `export function typeScore(fields: { present: boolean; typeCompatible: boolean }[]): number | null`
  - `export function scoreParts(contract: EventContract | undefined, snapshot: CompareSnapshot | null): ScoreParts`
  - `export function compareRowFromContract(eventName: string): CompareRow | null`
  - `export function compareRowFromCache(eventName: string, snapshot: CompareSnapshot | null, refreshedAt: string | null, lastError: string | null): CompareRow`
  - `export const GEL_CONTRACT: EventContract`

- [ ] **Step 1: Write the failing test**

Create `src/eventCompare.test.ts`:

```ts
import { expect, test } from "bun:test";
import {
  closedDayWindow,
  compareRowFromCache,
  compareRowFromContract,
  compositeScore,
  contractFor,
  contractsForRepo,
  formatScoreTitle,
  populatedScore,
  scoreParts,
  typesCompatible,
  volumeScore,
  type CompareSnapshot,
  type ScoreParts,
  type SnapshotField,
} from "./eventCompare";

test("closedDayWindow is last 7 UTC days excluding today", () => {
  expect(closedDayWindow(new Date("2026-08-26T16:00:00Z"))).toEqual({
    start: "2026-08-19",
    end: "2026-08-25",
  });
});

test("typesCompatible matches spec rules", () => {
  expect(typesCompatible("DATE", "DATE", "event_time")).toBe(true);
  expect(typesCompatible("TIMESTAMP_NTZ", "DATE", "event_time")).toBe(true);
  expect(typesCompatible("VARCHAR", "VARCHAR", "user")).toBe(true);
  expect(typesCompatible("FLOAT", "NUMBER", "duration")).toBe(true);
  expect(typesCompatible("VARCHAR", "VARCHAR", "environment")).toBe(true);
  expect(typesCompatible("BOOLEAN", "VARCHAR", "user")).toBe(false);
});

test("GEL contract is registered for wdesk_sdk", () => {
  const c = contractFor("General Experience Loading");
  expect(c?.repo).toBe("wdesk_sdk");
  expect(c?.fields).toHaveLength(6);
  expect(contractsForRepo("wdesk_sdk").map((x) => x.eventName)).toEqual(["General Experience Loading"]);
  expect(contractsForRepo("w_outline")).toEqual([]);
});

test("compositeScore averages non-pending parts only", () => {
  const pending: ScoreParts = { present: null, type: null, populated: null, volume: null };
  expect(compositeScore(pending)).toBeNull();
  expect(compositeScore({ present: 100, type: 100, populated: null, volume: null })).toBe(100);
  expect(compositeScore({ present: 100, type: 50, populated: 0, volume: 100 })).toBe(63);
});

test("formatScoreTitle lists pending parts", () => {
  expect(
    formatScoreTitle({ present: 100, type: 100, populated: null, volume: null }),
  ).toBe("Present 100% · Type 100% · Populated pending · Volume pending");
});

test("volumeScore matches spec", () => {
  expect(volumeScore(null, 10)).toBeNull();
  expect(volumeScore(10, null)).toBeNull();
  expect(volumeScore(0, 0)).toBe(100);
  expect(volumeScore(0, 10)).toBe(0);
  expect(volumeScore(80, 100)).toBe(80);
});

test("populatedScore needs fills on both sides", () => {
  const fields: SnapshotField[] = [
    {
      key: "user",
      aiColumn: "user_resource_id",
      aiType: "VARCHAR",
      ampColumn: "user_resource_id",
      ampType: "VARCHAR",
      present: true,
      typeCompatible: true,
      aiFill: 0.9,
      ampFill: 0.9,
    },
    {
      key: "organization",
      aiColumn: "organization_id",
      aiType: "VARCHAR",
      ampColumn: "organization_id",
      ampType: "VARCHAR",
      present: true,
      typeCompatible: true,
      aiFill: 0.4,
      ampFill: 0.9,
    },
  ];
  expect(populatedScore(fields)).toBe(50);
  expect(populatedScore(fields.map((f) => ({ ...f, aiFill: null })))).toBeNull();
});

test("scoreParts uses contract when snapshot is missing", () => {
  const parts = scoreParts(contractFor("General Experience Loading"), null);
  expect(parts.present).toBe(100);
  expect(parts.type).toBe(100);
  expect(parts.populated).toBeNull();
  expect(parts.volume).toBeNull();
  expect(compareRowFromContract("General Experience Loading")?.match).toBe(100);
  expect(compareRowFromContract("Clicked Save")).toBeNull();
});

test("compareRowFromCache scores volume from snapshot", () => {
  const snapshot: CompareSnapshot = {
    version: 1,
    window: { start: "2026-08-19", end: "2026-08-25" },
    volume: { ai: null, amp: 100 },
    fields: [],
  };
  const row = compareRowFromCache("General Experience Loading", snapshot, "2026-08-26T00:00:00.000Z", "timeout");
  expect(row.parts.present).toBe(100);
  expect(row.parts.volume).toBeNull();
  expect(row.lastError).toBe("timeout");
  expect(row.match).toBe(100);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/eventCompare.test.ts`

Expected: FAIL with `Cannot find module './eventCompare'`

- [ ] **Step 3: Write minimal implementation**

Create `src/eventCompare.ts` with the types above and:

```ts
export const POPULATED_FLOOR = 0.5;

export function ymdUtc(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function closedDayWindow(now = new Date()): { start: string; end: string } {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  end.setUTCDate(end.getUTCDate() - 1);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 6);
  return { start: ymdUtc(start), end: ymdUtc(end) };
}

function isDateLike(t: string): boolean {
  const u = t.toUpperCase();
  return u.includes("DATE") || u.includes("TIMESTAMP");
}
function isString(t: string): boolean {
  const u = t.toUpperCase();
  return u.includes("VARCHAR") || u.includes("STRING") || u === "TEXT";
}
function isNumeric(t: string): boolean {
  const u = t.toUpperCase();
  return u.includes("FLOAT") || u.includes("NUMBER") || u.includes("DOUBLE") || u.includes("INT");
}

export function typesCompatible(aiType: string, ampType: string, key: FieldKey): boolean {
  if (key === "environment") return isString(aiType) && isString(ampType);
  if (isDateLike(aiType) && isDateLike(ampType)) return true;
  if (isString(aiType) && isString(ampType)) return true;
  if (isNumeric(aiType) && isNumeric(ampType)) return true;
  return false;
}

const gelFields: ContractField[] = [
  { key: "event_time", label: "Event time", aiColumn: "analytic_date", aiType: "DATE", ampColumn: "event_date", ampType: "DATE", present: true, typeCompatible: true },
  { key: "user", label: "User", aiColumn: "user_resource_id", aiType: "VARCHAR", ampColumn: "user_resource_id", ampType: "VARCHAR", present: true, typeCompatible: true },
  { key: "organization", label: "Organization", aiColumn: "organization_id", aiType: "VARCHAR", ampColumn: "organization_id", ampType: "VARCHAR", present: true, typeCompatible: true },
  { key: "workspace", label: "Workspace", aiColumn: "account_resource_id", aiType: "VARCHAR", ampColumn: "workspace_id", ampType: "VARCHAR", present: true, typeCompatible: true },
  { key: "duration", label: "Duration", aiColumn: "value", aiType: "FLOAT", ampColumn: "raw_event_properties:value", ampType: "NUMBER", present: true, typeCompatible: true },
  { key: "environment", label: "Environment", aiColumn: "environment", aiType: "VARCHAR", ampColumn: "environment", ampType: "VARCHAR", present: true, typeCompatible: true },
];

export const GEL_CONTRACT: EventContract = {
  eventName: "General Experience Loading",
  repo: "wdesk_sdk",
  aiTable: "silver_prod.user_analytic.general_experience_loading",
  ampEventType: "General Experience Loading",
  fields: gelFields,
  omitted: [
    { name: "experience_name vs experienceName", reason: "App Intel stores the route segment; Amplitude stores a telemetry label like Experience loaded in (ms)_TextBox-embedded." },
    { name: "session_id", reason: "App Intel session_id is an obfuscated token; Amplitude session_id is epoch milliseconds." },
  ],
  ampEnvs: ["us", "eu", "apac"],
  aiEnvs: ["production", "prod-eu", "prod-apac"],
};

const CONTRACTS: EventContract[] = [GEL_CONTRACT];

export function contractFor(eventName: string): EventContract | undefined {
  return CONTRACTS.find((c) => c.eventName === eventName);
}

export function contractsForRepo(repo: string): EventContract[] {
  return CONTRACTS.filter((c) => c.repo === repo);
}

export function compositeScore(parts: ScoreParts): number | null {
  const vals = [parts.present, parts.type, parts.populated, parts.volume].filter((n): n is number => n != null);
  if (!vals.length) return null;
  return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
}

export function formatScoreTitle(parts: ScoreParts): string {
  const label = (n: number | null) => (n == null ? "pending" : `${n}%`);
  return `Present ${label(parts.present)} · Type ${label(parts.type)} · Populated ${label(parts.populated)} · Volume ${label(parts.volume)}`;
}

export function volumeScore(ai: number | null, amp: number | null): number | null {
  if (ai == null || amp == null) return null;
  if (ai === 0 && amp === 0) return 100;
  if (ai === 0 || amp === 0) return 0;
  return Math.round((100 * Math.min(ai, amp)) / Math.max(ai, amp));
}

export function presentScore(fields: { present: boolean }[]): number | null {
  if (!fields.length) return null;
  return Math.round((100 * fields.filter((f) => f.present).length) / fields.length);
}

export function typeScore(fields: { present: boolean; typeCompatible: boolean }[]): number | null {
  const both = fields.filter((f) => f.present);
  if (!both.length) return null;
  return Math.round((100 * both.filter((f) => f.typeCompatible).length) / both.length);
}

export function populatedScore(fields: SnapshotField[]): number | null {
  const both = fields.filter((f) => f.present);
  if (!both.length) return null;
  if (both.some((f) => f.aiFill == null || f.ampFill == null)) return null;
  const ok = both.filter((f) => (f.aiFill ?? 0) >= POPULATED_FLOOR && (f.ampFill ?? 0) >= POPULATED_FLOOR);
  return Math.round((100 * ok.length) / both.length);
}

export function scoreParts(contract: EventContract | undefined, snapshot: CompareSnapshot | null): ScoreParts {
  if (!contract) return { present: null, type: null, populated: null, volume: null };
  const fields = snapshot?.fields.length ? snapshot.fields : contract.fields;
  return {
    present: presentScore(fields),
    type: typeScore(fields),
    populated: snapshot ? populatedScore(snapshot.fields) : null,
    volume: snapshot ? volumeScore(snapshot.volume.ai, snapshot.volume.amp) : null,
  };
}

function row(eventName: string, snapshot: CompareSnapshot | null, refreshedAt: string | null, lastError: string | null): CompareRow {
  const parts = scoreParts(contractFor(eventName), snapshot);
  return { eventName, snapshot, refreshedAt, lastError, parts, match: compositeScore(parts) };
}

export function compareRowFromContract(eventName: string): CompareRow | null {
  if (!contractFor(eventName)) return null;
  return row(eventName, null, null, null);
}

export function compareRowFromCache(
  eventName: string,
  snapshot: CompareSnapshot | null,
  refreshedAt: string | null,
  lastError: string | null,
): CompareRow {
  return row(eventName, snapshot, refreshedAt, lastError);
}
```

Also export the type aliases listed under Interfaces (copy them verbatim into the file).

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/eventCompare.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/eventCompare.ts src/eventCompare.test.ts
git commit -m "$(cat <<'EOF'
Add GEL compare contract and match score helpers.

EOF
)"
```

---

### Task 2: SQLite event_compare cache

**Files:**
- Modify: `src/db.ts`
- Modify: `src/db.test.ts`
- Create: `src/eventCompareCache.ts`
- Test: `src/eventCompareCache.test.ts`

**Interfaces:**
- Consumes: `CompareSnapshot` from Task 1
- Produces:
  - `openAppDatabase` also creates `event_compare`
  - `export type CachedCompare = { repo: string; eventName: string; snapshot: CompareSnapshot | null; refreshedAt: string | null; lastError: string | null }`
  - `export function listCompareCache(db: Database, repo: string): CachedCompare[]`
  - `export function getCompareCache(db: Database, repo: string, eventName: string): CachedCompare | undefined`
  - `export function putCompareCache(db: Database, row: CachedCompare): void`

`event_compare` columns: `repo TEXT NOT NULL, event_name TEXT NOT NULL, snapshot_json TEXT NOT NULL, refreshed_at TEXT, last_error TEXT, PRIMARY KEY (repo, event_name)`.

Empty snapshot JSON is still valid JSON (`{"version":1,...}`). Never store an empty string. `snapshot_json` for a contract-only insert uses a snapshot with `volume.ai/amp` null and field fills null (see `pendingSnapshot(contract, window)` in this task).

- [ ] **Step 1: Write the failing tests**

Append to `src/db.test.ts`:

```ts
test("openAppDatabase creates event_compare table", () => {
  const dir = mkdtempSync(join(tmpdir(), "sn-analytics-"));
  const path = join(dir, "app.sqlite");
  const db = openAppDatabase(path);
  try {
    const rows = db
      .query("SELECT name FROM sqlite_master WHERE type='table' AND name='event_compare'")
      .all();
    expect(rows.length).toBe(1);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
```

Create `src/eventCompareCache.test.ts`:

```ts
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openAppDatabase } from "./db";
import { GEL_CONTRACT, type CompareSnapshot } from "./eventCompare";
import { getCompareCache, listCompareCache, pendingSnapshot, putCompareCache } from "./eventCompareCache";

function tmpDb() {
  const dir = mkdtempSync(join(tmpdir(), "sn-analytics-"));
  const db = openAppDatabase(join(dir, "app.sqlite"));
  return { dir, db };
}

const window = { start: "2026-08-19", end: "2026-08-25" };

test("put and list preserve snapshot; error does not wipe snapshot", () => {
  const { dir, db } = tmpDb();
  try {
    const snap: CompareSnapshot = {
      version: 1,
      window,
      volume: { ai: null, amp: 12 },
      fields: pendingSnapshot(GEL_CONTRACT, window).fields,
    };
    putCompareCache(db, {
      repo: "wdesk_sdk",
      eventName: GEL_CONTRACT.eventName,
      snapshot: snap,
      refreshedAt: "2026-08-26T00:00:00.000Z",
      lastError: null,
    });
    putCompareCache(db, {
      repo: "wdesk_sdk",
      eventName: GEL_CONTRACT.eventName,
      snapshot: snap,
      refreshedAt: "2026-08-26T00:00:00.000Z",
      lastError: "timeout",
    });
    const got = getCompareCache(db, "wdesk_sdk", GEL_CONTRACT.eventName);
    expect(got?.lastError).toBe("timeout");
    expect(got?.snapshot?.volume.amp).toBe(12);
    expect(listCompareCache(db, "wdesk_sdk")).toHaveLength(1);
    expect(listCompareCache(db, "w_outline")).toHaveLength(0);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/db.test.ts src/eventCompareCache.test.ts`

Expected: FAIL — missing `event_compare` table and/or `eventCompareCache` module

- [ ] **Step 3: Write minimal implementation**

In `src/db.ts`, inside `openAppDatabase` after the `meta` `CREATE TABLE`, add:

```ts
  db.run(`CREATE TABLE IF NOT EXISTS event_compare (
    repo TEXT NOT NULL,
    event_name TEXT NOT NULL,
    snapshot_json TEXT NOT NULL,
    refreshed_at TEXT,
    last_error TEXT,
    PRIMARY KEY (repo, event_name)
  )`);
```

Create `src/eventCompareCache.ts`:

```ts
import type { Database } from "bun:sqlite";
import {
  type CompareSnapshot,
  type EventContract,
  type SnapshotField,
} from "./eventCompare";

export type CachedCompare = {
  repo: string;
  eventName: string;
  snapshot: CompareSnapshot | null;
  refreshedAt: string | null;
  lastError: string | null;
};

export function pendingSnapshot(contract: EventContract, window: { start: string; end: string }): CompareSnapshot {
  const fields: SnapshotField[] = contract.fields.map((f) => ({
    key: f.key,
    aiColumn: f.aiColumn,
    aiType: f.aiType,
    ampColumn: f.ampColumn,
    ampType: f.ampType,
    present: f.present,
    typeCompatible: f.typeCompatible,
    aiFill: null,
    ampFill: null,
  }));
  return { version: 1, window, volume: { ai: null, amp: null }, fields };
}

function parseSnapshot(json: string): CompareSnapshot | null {
  try {
    const v = JSON.parse(json) as CompareSnapshot;
    if (v?.version !== 1) return null;
    return v;
  } catch {
    return null;
  }
}

export function listCompareCache(db: Database, repo: string): CachedCompare[] {
  const rows = db
    .query(
      "SELECT repo, event_name, snapshot_json, refreshed_at, last_error FROM event_compare WHERE repo = ?",
    )
    .all(repo) as Array<{
    repo: string;
    event_name: string;
    snapshot_json: string;
    refreshed_at: string | null;
    last_error: string | null;
  }>;
  return rows.map((r) => ({
    repo: r.repo,
    eventName: r.event_name,
    snapshot: parseSnapshot(r.snapshot_json),
    refreshedAt: r.refreshed_at,
    lastError: r.last_error,
  }));
}

export function getCompareCache(db: Database, repo: string, eventName: string): CachedCompare | undefined {
  return listCompareCache(db, repo).find((r) => r.eventName === eventName);
}

export function putCompareCache(db: Database, row: CachedCompare): void {
  const snapshot = row.snapshot ?? { version: 1 as const, window: { start: "", end: "" }, volume: { ai: null, amp: null }, fields: [] };
  db.run(
    `INSERT INTO event_compare (repo, event_name, snapshot_json, refreshed_at, last_error)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(repo, event_name) DO UPDATE SET
       snapshot_json = excluded.snapshot_json,
       refreshed_at = excluded.refreshed_at,
       last_error = excluded.last_error`,
    [row.repo, row.eventName, JSON.stringify(snapshot), row.refreshedAt, row.lastError],
  );
}
```

When updating with an error and the caller passes the **previous** snapshot (Task 3), `putCompareCache` overwrites `last_error` but keeps that snapshot JSON. Task 3 is responsible for passing the old snapshot on failure.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/db.test.ts src/eventCompareCache.test.ts src/eventCompare.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/db.ts src/db.test.ts src/eventCompareCache.ts src/eventCompareCache.test.ts
git commit -m "$(cat <<'EOF'
Cache event comparison snapshots in SQLite.

EOF
)"
```

---

### Task 3: Snowflake refresh (fake fetch)

**Files:**
- Create: `src/eventCompareRefresh.ts`
- Test: `src/eventCompareRefresh.test.ts`

**Interfaces:**
- Consumes: `executeStatement`, `SnowflakeCreds`, `ExecuteDeps` from `src/snowflakeEvents.ts`; cache helpers and `pendingSnapshot` from Tasks 1–2
- Produces:
  - `export function ampVolumeSql(contract: EventContract, window: { start: string; end: string }): string`
  - `export function ampFillSql(contract: EventContract, window: { start: string; end: string }): string`
  - `export function aiVolumeSql(contract: EventContract, window: { start: string; end: string }): string`
  - `export function aiFillSql(contract: EventContract, window: { start: string; end: string }): string`
  - `export async function refreshEventCompare(repo: string, eventName: string, db: Database, creds: SnowflakeCreds, deps?: ExecuteDeps & { now?: () => Date }): Promise<CompareRow>`
  - `export async function refreshRepoCompares(repo: string, db: Database, creds: SnowflakeCreds, deps?: ExecuteDeps & { now?: () => Date }): Promise<CompareRow[]>` — sequential `for` over `contractsForRepo(repo)`

SQL (GEL): Amplitude volume:

```sql
SELECT COUNT(*) AS event_count
FROM gold_prod.marts.fct_amplitude_events
WHERE source_event_type = 'General Experience Loading'
  AND is_amplitude_generated_event = FALSE
  AND event_date BETWEEN '2026-08-19' AND '2026-08-25'
  AND environment IN ('us','eu','apac')
```

Amplitude fills: `COUNT(*)` plus `COUNT` of each amp column (`TRY_TO_DOUBLE(raw_event_properties:value::STRING)` for duration). App Intel volume: `COUNT(*)` from `contract.aiTable` with `analytic_date BETWEEN start AND end` and `environment IN (...)`. App Intel fills analogously (`COUNT(value)` for duration).

Refresh algorithm:
1. If no contract, throw `No compare contract for {eventName}`.
2. `window = closedDayWindow(deps.now?.() ?? new Date())`.
3. `existing = getCompareCache(...)`.
4. Start from `pendingSnapshot(contract, window)`.
5. Run Amplitude volume then Amplitude fills. On success, set `volume.amp` and `ampFill` on fields.
6. Run App Intel volume then fills. On success, set `volume.ai` and `aiFill`. On throw, set `lastError` to the error message and keep Amplitude data already on the snapshot. If a previous snapshot existed and Amplitude also failed, keep `existing.snapshot` and set `lastError`.
7. `refreshedAt` is ISO now only when **Amplitude** succeeded (so we have a usable snapshot). If Amplitude fails and a previous snapshot exists, keep previous `refreshedAt`. If nothing succeeded and no previous snapshot, `refreshedAt` is null and store the pending snapshot plus `lastError`.
8. `putCompareCache` then `return compareRowFromCache(...)`.

- [ ] **Step 1: Write the failing tests**

Create `src/eventCompareRefresh.test.ts`. Reuse the `jsonResponse` pattern from `src/snowflakeEvents.test.ts`. Tests:

1. `ampVolumeSql` contains `source_event_type = 'General Experience Loading'`, `environment IN ('us','eu','apac')`, and the window dates.
2. Fake fetch: first two statements return `[["100"]]` (volume) and a fill row `[["100","100","90","90","90","80","100"]]` in field order event_time, user, organization, workspace, duration, environment. App Intel statements throw (fetch returns 408). Result: `volume.amp === 100`, `volume.ai === null`, `lastError` includes `408`, `parts.volume` is null, `parts.present` is 100.
3. `refreshRepoCompares("w_outline", ...)` returns `[]` without calling fetch.

Include `now: () => new Date("2026-08-26T16:00:00Z")` so SQL dates are 2026-08-19 / 2026-08-25.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/eventCompareRefresh.test.ts`

Expected: FAIL missing module

- [ ] **Step 3: Write minimal implementation**

Implement SQL builders with `IN ('${contract.ampEnvs.join("','")}')` (envs are literals from the contract, not user input). Parse Snowflake string cells with `Number.parseInt` / `Number.parseFloat`. Fill rates = `count / n` when `n > 0`, else `0`. Catch errors around App Intel calls only after Amplitude is stored on a local `snapshot` variable.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/eventCompareRefresh.test.ts src/eventCompare.test.ts src/eventCompareCache.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/eventCompareRefresh.ts src/eventCompareRefresh.test.ts
git commit -m "$(cat <<'EOF'
Refresh event compare snapshots from Snowflake with cache fallback.

EOF
)"
```

---

### Task 4: HTTP API

**Files:**
- Modify: `src/index.tsx`
- Create: `src/eventCompareApi.ts`
- Test: `src/eventCompareApi.test.ts`

**Interfaces:**
- Consumes: cache list + `compareRowFromCache` / `compareRowFromContract`; `refreshEventCompare` / `refreshRepoCompares`; `credsFromEnv`; `openAppDatabase` / `sqlitePathFromEnv`
- Produces:
  - `export function compareGetResponse(db: Database, repo: string): { rows: CompareRow[] }` — cache rows only (no synthetic contract rows)
  - `export async function compareRefreshEvent(db: Database, repo: string, eventName: string): Promise<{ rows: CompareRow[] }>`
  - `export async function compareRefreshRepo(db: Database, repo: string): Promise<{ rows: CompareRow[] }>`
  - Routes (always JSON, POST always HTTP 200 even when `lastError` is set; `credsFromEnv` throw → HTTP 500 with `{ error: message }`):
    - `GET /api/compare/:repo`
    - `POST /api/compare/:repo/refresh`
    - `POST /api/compare/:repo/events/:eventName/refresh` — `decodeURIComponent(req.params.eventName)`

Keep a module-level `const db = openAppDatabase(sqlitePathFromEnv())` in `eventCompareApi.ts` used by the route handlers exported as `compareRoutes` **or** pass `db` from `index.tsx` after the existing `openAppDatabase` call. Prefer: `index.tsx` keeps one `const db = openAppDatabase(...)` and passes it into handler closures. Tests call `compareGetResponse(db, repo)` with a temp db (no HTTP).

- [ ] **Step 1: Write the failing tests**

`src/eventCompareApi.test.ts`: temp db, `putCompareCache` one GEL row, `compareGetResponse(db, "wdesk_sdk").rows[0].eventName` is GEL, `compareGetResponse(db, "w_outline").rows` is `[]`. Do not call Snowflake.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/eventCompareApi.test.ts`

Expected: FAIL missing module

- [ ] **Step 3: Write handlers and wire routes**

`compareGetResponse` maps `listCompareCache` through `compareRowFromCache`. Refresh handlers call Task 3 functions and return `{ rows }`. Add the three routes in `src/index.tsx` next to the existing `/api/hello` routes (same `Bun.serve` `routes` object).

- [ ] **Step 4: Run tests**

Run: `bun test src/eventCompareApi.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/eventCompareApi.ts src/eventCompareApi.test.ts src/index.tsx
git commit -m "$(cat <<'EOF'
Expose cached event comparison over HTTP.

EOF
)"
```

---

### Task 5: Inspect modal and row chrome

**Files:**
- Modify: `src/ui.tsx` (add `RefreshIcon`)
- Create: `src/EventCompareModal.tsx`
- Test: `src/EventCompareModal.test.ts`
- Modify: `src/AppDetail.tsx`

**Interfaces:**
- Consumes: `CompareRow`, `contractFor`, `formatScoreTitle`, `pctColor`, `MagnifyIcon`
- Produces:
  - `export function RefreshIcon({ size?: number }): JSX.Element` — circular arrow, `aria-hidden`
  - `export function EventCompareModal({ row, legacy, onClose }: { row: CompareRow; legacy: string[]; onClose: () => void }): JSX.Element`
  - `AppDetail` loads `GET /api/compare/:repo` once; merges POST bodies into `Record<string, CompareRow>`
  - Row overlay: `cache[ev.name] ?? compareRowFromContract(ev.name)`
  - Columns after GitHub: Match, Refresh, Inspect
  - Header: Refresh all + last successful `refreshedAt` among overlay rows (`Never` if none). If any `lastError` exists, show it under that timestamp without clearing Match %
  - Inspect sets `inspecting: MigrationEvent | null`; render modal when set
  - Escape calls `onClose` (window `keydown` in the modal `useEffect`)
  - Refresh buttons `disabled={busy}` where `busy` is a `Set` of event names or `"*"` for refresh-all
  - Match cell: `row?.match == null ? "—" : `${row.match}%`` with `title={formatScoreTitle(row.parts)}` and `pctColor`
  - Refresh disabled when `!contractFor(ev.name)`
  - Modal body order: chips, volume stats (pending vs number, **no gap %** if either side pending), comparable fields table (column + type, Present yes/no, Type yes/no, Populated `n%`/`n%` or pending), `<details>` Not compared from `contract.omitted`

Use existing tokens (`surf`, `txt-2`, `txt-3`, `--border`, `--surface-1`). Dialog: `role="dialog"` `aria-modal="true"` `aria-labelledby` pointing at the event name heading. Overlay button/backdrop click closes.

`EventCompareModal.test.ts` uses `renderToString` from `react-dom/server`:

```ts
import { renderToString } from "react-dom/server";
import { compareRowFromContract } from "./eventCompare";
import { EventCompareModal } from "./EventCompareModal";

test("GEL modal lists comparable fields and omitted note", () => {
  const row = compareRowFromContract("General Experience Loading")!;
  const html = renderToString(
    <EventCompareModal row={row} legacy={["GeneralExperienceLoadingEventV2"]} onClose={() => {}} />,
  );
  expect(html).toContain("General Experience Loading");
  expect(html).toContain("analytic_date");
  expect(html).toContain("event_date");
  expect(html).toContain("Populated");
  expect(html).toContain("pending");
  expect(html).toContain("experience_name");
  expect(html).not.toContain("same event instance");
});
```

- [ ] **Step 1: Write the failing modal test**

- [ ] **Step 2: Run `bun test src/EventCompareModal.test.ts` — expect FAIL missing module**

- [ ] **Step 3: Implement `RefreshIcon`, `EventCompareModal`, and `AppDetail` wiring**

Client fetch helper inside `AppDetail.tsx` (keep it local, no extra file):

```ts
async function postRefresh(url: string): Promise<CompareRow[]> {
  const res = await fetch(url, { method: "POST" });
  const body = (await res.json()) as { rows?: CompareRow[]; error?: string };
  if (!res.ok) throw new Error(body.error ?? res.statusText);
  return body.rows ?? [];
}
```

`useEffect` GET `/api/compare/${encodeURIComponent(r.repo)}` on `r.repo` change.

Refresh all: `POST /api/compare/${encodeURIComponent(r.repo)}/refresh` then merge rows.

Per-event: `POST /api/compare/${encodeURIComponent(r.repo)}/events/${encodeURIComponent(ev.name)}/refresh`.

- [ ] **Step 4: Run `bun test src/EventCompareModal.test.ts src/eventCompare.test.ts`**

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/ui.tsx src/EventCompareModal.tsx src/EventCompareModal.test.ts src/AppDetail.tsx
git commit -m "$(cat <<'EOF'
Add event compare inspect modal and refresh actions.

EOF
)"
```

- [ ] **Step 6: Browser check**

Run: `bun dev` (existing script). Open `http://localhost:3000/app/wdesk_sdk`. Confirm: Match % on GEL (100 from Present+Type), Inspect opens modal with six fields and collapsed Not compared, Escape closes, Refresh all / row refresh are enabled, other events show Match `—` and disabled refresh. Do not require Snowflake success. If `bun dev` is already running, use that server.

---

## Spec coverage (self-review)

| Spec section | Task |
|---|---|
| Row Match + Inspect + Refresh icons | 5 |
| Composite score / pending average | 1 |
| Present / Type / Populated / Volume formulas | 1 |
| Env map and closed-day window | 1, 3 |
| Modal chips, volume, fields, omitted | 5 |
| GEL contract columns | 1 |
| SQLite cache + failed refresh keeps snapshot | 2, 3 |
| GET cache-only; POST refresh | 4 |
| No Snowflake on page load | 4, 5 |
| No exact value comparison | 1, 5 (modal copy + no value column) |
| Tests without network | 1–5 |

No `?inspect=`. Header `% live` unchanged.
