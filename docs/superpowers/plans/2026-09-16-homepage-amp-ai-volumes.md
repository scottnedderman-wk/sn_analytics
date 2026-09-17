# Homepage Amp vs App Intel 30d Volumes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a homepage Refresh that loads Amplitude and App Intel 30-day counts from Snowflake, writes `src/data.json`, and shows Amp vs AI volumes on repo cards and AppSummary.

**Architecture:** `POST /api/homepage/refresh` reads `data.json`, runs two Snowflake rollups plus daily series for top-5 Amp-live events per app, merges with `applyHomepageVolumes`, writes the file only on full success, and returns `{ data }`. The client replaces in-memory `DashboardData`. Identities live on events; refresh only joins. KPIs and the progress bar stay Amplitude-only.

**Tech Stack:** Bun, TypeScript, React 19, `bun:test`, Snowflake SQL API via existing `executeStatement`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-09-16-homepage-amp-ai-volumes-design.md`
- Window: 30 closed UTC days ending today − `INGEST_LAG_DAYS` (2)
- Amplitude: `gold_prod.marts.fct_amplitude_events`, `PROD_WH`, `is_amplitude_generated_event = FALSE`, env `us`/`eu`/`apac`
- App Intel: `SILVER_PROD.ADMIN.USER_ANALYTIC`, `PROD_SILVER_LARGE_DBT_WAREHOUSE`, date `TRY_TO_TIMESTAMP(dimensions:timestamp::VARCHAR)::DATE`, env `production`/`prod-eu`/`prod-apac`
- Role: `TECH_ANALYST`. Auth: `SNOWFLAKE_PAT`
- Do not call the Amplitude Dashboard API
- Do not change Live/KPI/progress meaning from App Intel volume
- Do not split App Detail 30d columns
- `bun test` only; no live Snowflake in tests
- Write `src/data.json` only after a complete successful merge (`JSON.stringify(data, null, 2) + "\n"`)
- Skip git commit steps unless the user explicitly asked to commit

## File map

| File | Responsibility |
|---|---|
| `src/model.ts` | `ai*` fields on events/repos/root; `formatUpdatedAgo` |
| `src/homepageVolumes.ts` | Window, identity seed/match, `applyHomepageVolumes` |
| `src/homepageRefresh.ts` | Snowflake SQL + refresh orchestration + atomic write |
| `src/homepageApi.ts` | `POST /api/homepage/refresh` |
| `src/index.tsx` | Register the route |
| `src/App.tsx` | Pass `onData` into Dashboard |
| `src/Dashboard.tsx` | Refresh button, Updated copy, Amp+AI card totals |
| `src/AppSummary.tsx` | Grouped Amplitude / App Intel headers |
| `src/data.json` | Persist identities + later refreshed volumes |

---

### Task 1: Types, 30d window, Updated copy

**Files:**
- Modify: `src/model.ts`
- Modify: `src/App.tsx` (re-export `formatUpdatedAgo`)
- Modify: `src/App.test.ts`
- Create: `src/homepageVolumes.ts`
- Create: `src/homepageVolumes.test.ts`

**Interfaces:**
- Consumes: `INGEST_LAG_DAYS`, `ymdUtc` from `src/eventCompare.ts`
- Produces: `MigrationEvent` optional `aiCategory`, `aiAction`, `aiEvent`, `aiEventExclude`, `ai30`, `aiSeries30`; `RepoRecord.volume30Ai`; `DashboardData.volumeRefreshedAt`; `formatUpdatedAgo(isoOrYmd: string, now?: Date): string`; `HOMEPAGE_VOLUME_DAYS = 30`; `homepageDayWindow(now?: Date): { start: string; end: string }`

- [ ] **Step 1: Write the failing tests**

Add to `src/App.test.ts`:

```ts
import { formatUpdatedAgo } from "./App";

test("formatUpdatedAgo uses today / yesterday / N days ago", () => {
  const now = new Date("2026-09-16T18:00:00Z");
  expect(formatUpdatedAgo("2026-09-16T12:00:00.000Z", now)).toBe("Updated today");
  expect(formatUpdatedAgo("2026-09-15T00:00:00.000Z", now)).toBe("Updated yesterday");
  expect(formatUpdatedAgo("2026-09-13", now)).toBe("Updated 3 days ago");
});
```

Create `src/homepageVolumes.test.ts`:

```ts
import { expect, test } from "bun:test";
import { homepageDayWindow } from "./homepageVolumes";

test("homepageDayWindow is 30 UTC days ending 2 days ago", () => {
  expect(homepageDayWindow(new Date("2026-08-26T16:00:00Z"))).toEqual({
    start: "2026-07-26",
    end: "2026-08-24",
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/App.test.ts src/homepageVolumes.test.ts`

Expected: FAIL — `formatUpdatedAgo` / `homepageDayWindow` not exported.

- [ ] **Step 3: Minimal implementation**

In `src/model.ts` add optional fields on the existing types:

```ts
export type MigrationEvent = {
  // ...existing fields...
  series30?: number[];
  aiCategory?: string;
  aiAction?: string;
  aiEvent?: string;
  aiEventExclude?: string[];
  ai30?: number | null;
  aiSeries30?: number[];
};

export type RepoRecord = {
  // ...existing fields...
  volume30: number;
  volume30Ai?: number;
  // ...
};

export type DashboardData = {
  provenance: string;
  volumeAsOf?: string;
  volumeWindowDays?: number;
  volumeRefreshedAt?: string;
  repos: RepoRecord[];
};

export function formatUpdatedAgo(isoOrYmd: string, now = new Date()): string {
  const raw = isoOrYmd.length <= 10 ? `${isoOrYmd}T00:00:00.000Z` : isoOrYmd;
  const then = new Date(raw);
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const day = Date.UTC(then.getUTCFullYear(), then.getUTCMonth(), then.getUTCDate());
  const days = Math.round((today - day) / 86_400_000);
  if (days <= 0) return "Updated today";
  if (days === 1) return "Updated yesterday";
  return `Updated ${days} days ago`;
}
```

Create `src/homepageVolumes.ts`:

```ts
import { INGEST_LAG_DAYS, ymdUtc } from "./eventCompare";

export const HOMEPAGE_VOLUME_DAYS = 30;

export function homepageDayWindow(now = new Date()): { start: string; end: string } {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  end.setUTCDate(end.getUTCDate() - INGEST_LAG_DAYS);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - (HOMEPAGE_VOLUME_DAYS - 1));
  return { start: ymdUtc(start), end: ymdUtc(end) };
}
```

Re-export `formatUpdatedAgo` from `src/App.tsx`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/App.test.ts src/homepageVolumes.test.ts`

Expected: PASS

- [ ] **Step 5: Commit** (skip unless the user asked)

```bash
git add src/model.ts src/App.tsx src/App.test.ts src/homepageVolumes.ts src/homepageVolumes.test.ts
git commit -m "Add homepage 30d window and Updated-ago copy"
```

---

### Task 2: Identity seed and App Intel cell matching

**Files:**
- Modify: `src/homepageVolumes.ts`
- Modify: `src/homepageVolumes.test.ts`

**Interfaces:**
- Consumes: `contractFor`, `EventContract` from `src/eventCompare.ts`; `MigrationEvent` / `DashboardData` from `src/model.ts`
- Produces:
  - `export type AiCell = { category: string; action: string; event: string | null; count: number }`
  - `export function identityFromLegacy(legacy: string[]): Pick<MigrationEvent, "aiCategory" | "aiAction" | "aiEvent"> | null`
  - `export function seedAiIdentities(data: DashboardData): DashboardData`
  - `export function aiCountForEvent(ev: MigrationEvent, cells: AiCell[]): number | null`

- [ ] **Step 1: Write the failing tests**

Append to `src/homepageVolumes.test.ts`:

```ts
import { contractFor, type DashboardData } from "./eventCompare";
import {
  aiCountForEvent,
  identityFromLegacy,
  seedAiIdentities,
  type AiCell,
} from "./homepageVolumes";
import type { MigrationEvent } from "./model";

const event = (over: Partial<MigrationEvent> = {}): MigrationEvent => ({
  name: "Clicked Save",
  legacy: ["SaveEventV1"],
  status: "live",
  v30: 0,
  v365: 0,
  dev30: 0,
  merged: false,
  pr: null,
  amp_count: null,
  ss_error: "",
  queried: 0,
  ...over,
});

test("identityFromLegacy maps named shell dual-writes", () => {
  expect(identityFromLegacy(["ShellGenericAnalyticEventV2", "aboutWorkiva"])).toEqual({
    aiCategory: "shell",
    aiAction: "generic-analytic",
    aiEvent: "aboutWorkiva",
  });
  expect(identityFromLegacy(["SaveEventV1"])).toBeNull();
});

test("seedAiIdentities copies contracts and named shell tokens", () => {
  const data: DashboardData = {
    provenance: "t",
    repos: [
      {
        repo: "wdesk_sdk",
        events: [
          event({ name: "About Workiva", legacy: ["ShellGenericAnalyticEventV2", "aboutWorkiva"] }),
          event({ name: "General Experience Loading", legacy: ["GeneralExperienceLoadingEventV2"] }),
          event({ name: "Shell Generic Analytic", legacy: ["ShellGenericAnalyticEventV2"] }),
        ],
        counts: {},
        total: 3,
        live: 0,
        volume30: 0,
        sources: [],
        prs: [],
        inv_mapped: 0,
        inv_unmapped: 0,
      },
    ],
  };
  const seeded = seedAiIdentities(data);
  const byName = Object.fromEntries(seeded.repos[0]!.events.map((e) => [e.name, e]));
  expect(byName["About Workiva"]).toMatchObject({
    aiCategory: "shell",
    aiAction: "generic-analytic",
    aiEvent: "aboutWorkiva",
  });
  expect(byName["General Experience Loading"]).toMatchObject({
    aiCategory: "general",
    aiAction: "experience-loading",
  });
  const remainder = contractFor("Shell Generic Analytic")!;
  expect(byName["Shell Generic Analytic"]!.aiEventExclude).toEqual(remainder.aiEventExclude);
  expect(byName["Shell Generic Analytic"]!.aiEvent).toBeUndefined();
});

test("aiCountForEvent matches named, dedicated, and remainder cells without overlap", () => {
  const cells: AiCell[] = [
    { category: "shell", action: "generic-analytic", event: "aboutWorkiva", count: 10 },
    { category: "shell", action: "generic-analytic", event: "experienceAlreadyOpen", count: 5 },
    { category: "shell", action: "generic-analytic", event: "progressItem.high", count: 7 },
    { category: "shell", action: "generic-analytic", event: "otherThing", count: 3 },
    { category: "general", action: "experience-loading", event: null, count: 100 },
  ];
  expect(
    aiCountForEvent(
      event({ aiCategory: "shell", aiAction: "generic-analytic", aiEvent: "aboutWorkiva" }),
      cells,
    ),
  ).toBe(10);
  expect(
    aiCountForEvent(event({ aiCategory: "general", aiAction: "experience-loading" }), cells),
  ).toBe(100);
  expect(
    aiCountForEvent(
      event({
        aiCategory: "shell",
        aiAction: "generic-analytic",
        aiEventExclude: ["aboutWorkiva", "experienceAlreadyOpen"],
      }),
      cells,
    ),
  ).toBe(3);
  expect(aiCountForEvent(event(), cells)).toBeNull();
});
```

Import `DashboardData` from `./model`, not `eventCompare`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/homepageVolumes.test.ts`

Expected: FAIL — exports missing.

- [ ] **Step 3: Minimal implementation**

In `src/homepageVolumes.ts`:

```ts
import { contractFor } from "./eventCompare";
import type { DashboardData, MigrationEvent } from "./model";

export type AiCell = { category: string; action: string; event: string | null; count: number };

function isCamelToken(s: string): boolean {
  return /^[a-z][A-Za-z0-9]*$/.test(s);
}

export function identityFromLegacy(
  legacy: string[],
): Pick<MigrationEvent, "aiCategory" | "aiAction" | "aiEvent"> | null {
  if (!legacy.includes("ShellGenericAnalyticEventV2")) return null;
  const token = legacy.find((l) => l !== "ShellGenericAnalyticEventV2" && isCamelToken(l));
  if (!token) return null;
  return { aiCategory: "shell", aiAction: "generic-analytic", aiEvent: token };
}

export function seedAiIdentities(data: DashboardData): DashboardData {
  return {
    ...data,
    repos: data.repos.map((repo) => ({
      ...repo,
      events: repo.events.map((ev) => {
        const fromContract = contractFor(ev.name);
        if (fromContract) {
          return {
            ...ev,
            aiCategory: fromContract.aiCategory,
            aiAction: fromContract.aiAction,
            ...(fromContract.aiEvent ? { aiEvent: fromContract.aiEvent } : {}),
            ...(fromContract.aiEventExclude ? { aiEventExclude: fromContract.aiEventExclude } : {}),
          };
        }
        const fromLegacy = identityFromLegacy(ev.legacy);
        return fromLegacy ? { ...ev, ...fromLegacy } : ev;
      }),
    })),
  };
}

function likeExcluded(event: string): boolean {
  return (
    event.startsWith("progressItem.") ||
    event.startsWith("notificationItem.") ||
    event.startsWith("createMenuItem.")
  );
}

export function aiCountForEvent(ev: MigrationEvent, cells: AiCell[]): number | null {
  if (!ev.aiCategory || !ev.aiAction) return null;
  const mine = cells.filter((c) => c.category === ev.aiCategory && c.action === ev.aiAction);
  if (ev.aiEvent) {
    return mine.filter((c) => c.event === ev.aiEvent).reduce((s, c) => s + c.count, 0);
  }
  if (ev.aiEventExclude?.length) {
    const named = new Set(ev.aiEventExclude);
    return mine
      .filter((c) => {
        const name = c.event ?? "";
        return !named.has(name) && !likeExcluded(name);
      })
      .reduce((s, c) => s + c.count, 0);
  }
  return mine.reduce((s, c) => s + c.count, 0);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/homepageVolumes.test.ts`

Expected: PASS

- [ ] **Step 5: Commit** (skip unless the user asked)

---

### Task 3: `applyHomepageVolumes`

**Files:**
- Modify: `src/homepageVolumes.ts`
- Modify: `src/homepageVolumes.test.ts`

**Interfaces:**
- Consumes: `statusAfterVolume` from `src/amplitudeRefresh.ts`; `topLiveByVolume` from `src/model.ts`; `aiCountForEvent`
- Produces: `export function applyHomepageVolumes(data: DashboardData, ampTotals: Map<string, number>, aiCells: AiCell[], ampDaily: Map<string, number[]>, aiDaily: Map<string, number[]>, asOf: string, refreshedAt: string): DashboardData`

Daily maps are keyed by Amplitude event name. Arrays are length 30, index 0 = window start.

- [ ] **Step 1: Write the failing test**

```ts
import { applyHomepageVolumes } from "./homepageVolumes";

test("applyHomepageVolumes fills Amp/AI totals and does not let AI change status", () => {
  const data: DashboardData = {
    provenance: "t",
    repos: [
      {
        repo: "wdesk_sdk",
        events: [
          event({
            name: "About Workiva",
            status: "missing",
            v365: 0,
            aiCategory: "shell",
            aiAction: "generic-analytic",
            aiEvent: "aboutWorkiva",
          }),
          event({ name: "No Identity", status: "live", v30: 9 }),
        ],
        counts: { live: 1, missing: 1 },
        total: 2,
        live: 1,
        volume30: 9,
        sources: [],
        prs: [],
        inv_mapped: 0,
        inv_unmapped: 0,
      },
    ],
  };
  const amp = new Map([["About Workiva", 4]]);
  const cells: AiCell[] = [
    { category: "shell", action: "generic-analytic", event: "aboutWorkiva", count: 40 },
  ];
  const out = applyHomepageVolumes(
    data,
    amp,
    cells,
    new Map(),
    new Map(),
    "2026-08-24",
    "2026-08-26T16:00:00.000Z",
  );
  const about = out.repos[0]!.events[0]!;
  const none = out.repos[0]!.events[1]!;
  expect(about.v30).toBe(4);
  expect(about.status).toBe("live");
  expect(about.ai30).toBe(40);
  expect(none.v30).toBe(0);
  expect(none.status).toBe("stale");
  expect(none.ai30).toBeNull();
  expect(out.repos[0]!.volume30).toBe(4);
  expect(out.repos[0]!.volume30Ai).toBe(40);
  expect(out.volumeAsOf).toBe("2026-08-24");
  expect(out.volumeWindowDays).toBe(30);
  expect(out.volumeRefreshedAt).toBe("2026-08-26T16:00:00.000Z");
});

test("applyHomepageVolumes attaches daily series only for top-5 live preview names", () => {
  const data: DashboardData = {
    provenance: "t",
    repos: [
      {
        repo: "wdesk_sdk",
        events: [
          event({
            name: "A",
            status: "live",
            aiCategory: "general",
            aiAction: "experience-loading",
          }),
          event({ name: "B", status: "missing" }),
        ],
        counts: { live: 1 },
        total: 2,
        live: 1,
        volume30: 0,
        sources: [],
        prs: [],
        inv_mapped: 0,
        inv_unmapped: 0,
      },
    ],
  };
  const series = Array.from({ length: 30 }, () => 1);
  const out = applyHomepageVolumes(
    data,
    new Map([["A", 10]]),
    [{ category: "general", action: "experience-loading", event: null, count: 8 }],
    new Map([["A", series]]),
    new Map([["A", series]]),
    "2026-08-24",
    "2026-08-26T16:00:00.000Z",
  );
  expect(out.repos[0]!.events[0]!.series30).toEqual(series);
  expect(out.repos[0]!.events[0]!.aiSeries30).toEqual(series);
  expect(out.repos[0]!.events[1]!.series30).toBeUndefined();
  expect(out.repos[0]!.events[1]!.aiSeries30).toBeUndefined();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/homepageVolumes.test.ts`

Expected: FAIL — `applyHomepageVolumes` not exported.

- [ ] **Step 3: Minimal implementation**

```ts
import { statusAfterVolume } from "./amplitudeRefresh";
import { topLiveByVolume } from "./model";

export function applyHomepageVolumes(
  data: DashboardData,
  ampTotals: Map<string, number>,
  aiCells: AiCell[],
  ampDaily: Map<string, number[]>,
  aiDaily: Map<string, number[]>,
  asOf: string,
  refreshedAt: string,
): DashboardData {
  const repos = data.repos.map((repo) => {
    if (repo.events.length === 0) return repo;
    const events = repo.events.map((ev) => {
      const v30 = ampTotals.get(ev.name) ?? 0;
      const ai30 = aiCountForEvent(ev, aiCells);
      return { ...ev, v30, ai30, status: statusAfterVolume(ev, v30) };
    });
    const preview = new Set(topLiveByVolume(events, 5).map((e) => e.name));
    const withSeries = events.map((ev) => {
      if (!preview.has(ev.name)) {
        const { series30: _s, aiSeries30: _a, ...rest } = ev;
        return rest;
      }
      return {
        ...ev,
        ...(ampDaily.has(ev.name) ? { series30: ampDaily.get(ev.name) } : {}),
        ...(ev.ai30 != null && aiDaily.has(ev.name) ? { aiSeries30: aiDaily.get(ev.name) } : {}),
      };
    });
    let volume30 = 0;
    let volume30Ai = 0;
    const counts: DashboardData["repos"][number]["counts"] = {};
    for (const e of withSeries) {
      counts[e.status] = (counts[e.status] || 0) + 1;
      volume30 += e.v30 || 0;
      if (e.ai30 != null) volume30Ai += e.ai30;
    }
    return {
      ...repo,
      events: withSeries,
      counts,
      volume30,
      volume30Ai,
      live: counts.live || 0,
      total: withSeries.length,
    };
  });
  return { ...data, volumeAsOf: asOf, volumeWindowDays: 30, volumeRefreshedAt: refreshedAt, repos };
}
```

Do not strip `series30` via destructure if TypeScript complaints; instead omit by returning `{ ...ev, series30: undefined }` only when you must clear stale series. Preferred: after mapping totals, set `series30` / `aiSeries30` only on preview rows and delete them on others:

```ts
const next = { ...ev };
if (preview.has(ev.name)) {
  if (ampDaily.has(ev.name)) next.series30 = ampDaily.get(ev.name);
  if (ev.ai30 != null && aiDaily.has(ev.name)) next.aiSeries30 = aiDaily.get(ev.name);
} else {
  delete next.series30;
  delete next.aiSeries30;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/homepageVolumes.test.ts`

Expected: PASS

- [ ] **Step 5: Commit** (skip unless the user asked)

---

### Task 4: Snowflake SQL builders

**Files:**
- Modify: `src/homepageRefresh.ts` (create)
- Create: `src/homepageRefresh.test.ts`

**Interfaces:**
- Consumes: `homepageDayWindow`; `AiIdentity`-like `Pick<MigrationEvent, "aiCategory" | "aiAction" | "aiEvent" | "aiEventExclude">`
- Produces:
  - `ampHomepageVolumeSql(window: { start: string; end: string }): string`
  - `aiHomepageVolumeSql(window: { start: string; end: string }): string`
  - `ampHomepageDailySql(window: { start: string; end: string }, names: string[]): string`
  - `aiHomepageDailySql(window: { start: string; end: string }): string` — same grain as totals plus date (filter preview identities in-process)

- [ ] **Step 1: Write the failing tests**

```ts
import { expect, test } from "bun:test";
import {
  aiHomepageVolumeSql,
  ampHomepageDailySql,
  ampHomepageVolumeSql,
} from "./homepageRefresh";

const window = { start: "2026-07-26", end: "2026-08-24" };

test("ampHomepageVolumeSql groups by source_event_type", () => {
  const sql = ampHomepageVolumeSql(window);
  expect(sql).toContain("gold_prod.marts.fct_amplitude_events");
  expect(sql).toContain("source_event_type");
  expect(sql).toContain("is_amplitude_generated_event = FALSE");
  expect(sql).toContain("environment IN ('us','eu','apac')");
  expect(sql).toContain("2026-07-26");
  expect(sql).toContain("2026-08-24");
  expect(sql).toContain("GROUP BY 1");
});

test("aiHomepageVolumeSql groups by category, action, and dimensions:event", () => {
  const sql = aiHomepageVolumeSql(window);
  expect(sql).toContain("SILVER_PROD.ADMIN.USER_ANALYTIC");
  expect(sql).toContain("TRY_TO_TIMESTAMP(dimensions:timestamp::VARCHAR)::DATE");
  expect(sql).toContain("environment IN ('production','prod-eu','prod-apac')");
  expect(sql).toContain("dimensions:event::VARCHAR");
  expect(sql).not.toContain("analytic_date");
  expect(sql).toContain("GROUP BY 1, 2, 3");
});

test("ampHomepageDailySql restricts to preview names", () => {
  const sql = ampHomepageDailySql(window, ["General Experience Loading", "O'Brien"]);
  expect(sql).toContain("event_date");
  expect(sql).toContain("'General Experience Loading'");
  expect(sql).toContain("'O''Brien'");
  expect(sql).toContain("GROUP BY 1, 2");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/homepageRefresh.test.ts`

Expected: FAIL — module missing.

- [ ] **Step 3: Minimal implementation**

```ts
function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export function ampHomepageVolumeSql(window: { start: string; end: string }): string {
  return `SELECT source_event_type, COUNT(*) AS event_count
FROM gold_prod.marts.fct_amplitude_events
WHERE is_amplitude_generated_event = FALSE
  AND event_date BETWEEN '${window.start}' AND '${window.end}'
  AND environment IN ('us','eu','apac')
GROUP BY 1`;
}

export function aiHomepageVolumeSql(window: { start: string; end: string }): string {
  return `SELECT category, action, dimensions:event::VARCHAR AS ev, COUNT(*) AS event_count
FROM SILVER_PROD.ADMIN.USER_ANALYTIC
WHERE TRY_TO_TIMESTAMP(dimensions:timestamp::VARCHAR)::DATE BETWEEN '${window.start}' AND '${window.end}'
  AND environment IN ('production','prod-eu','prod-apac')
GROUP BY 1, 2, 3`;
}

export function ampHomepageDailySql(window: { start: string; end: string }, names: string[]): string {
  const inList = names.map(sqlString).join(",");
  return `SELECT source_event_type, event_date::VARCHAR AS d, COUNT(*) AS event_count
FROM gold_prod.marts.fct_amplitude_events
WHERE is_amplitude_generated_event = FALSE
  AND event_date BETWEEN '${window.start}' AND '${window.end}'
  AND environment IN ('us','eu','apac')
  AND source_event_type IN (${inList})
GROUP BY 1, 2
ORDER BY 1, 2`;
}

export function aiHomepageDailySql(window: { start: string; end: string }): string {
  return `SELECT category, action, dimensions:event::VARCHAR AS ev,
  TRY_TO_TIMESTAMP(dimensions:timestamp::VARCHAR)::DATE::VARCHAR AS d, COUNT(*) AS event_count
FROM SILVER_PROD.ADMIN.USER_ANALYTIC
WHERE TRY_TO_TIMESTAMP(dimensions:timestamp::VARCHAR)::DATE BETWEEN '${window.start}' AND '${window.end}'
  AND environment IN ('production','prod-eu','prod-apac')
GROUP BY 1, 2, 3, 4
ORDER BY 4`;
}
```

If `names` is empty, `ampHomepageDailySql` must still be valid SQL: `AND FALSE` instead of `IN ()`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/homepageRefresh.test.ts`

Expected: PASS

- [ ] **Step 5: Commit** (skip unless the user asked)

---

### Task 5: Refresh orchestration and HTTP route

**Files:**
- Modify: `src/homepageRefresh.ts`
- Modify: `src/homepageRefresh.test.ts`
- Create: `src/homepageApi.ts`
- Create: `src/homepageApi.test.ts`
- Modify: `src/index.tsx`

**Interfaces:**
- Consumes: `executeStatement`, `AI_STATEMENT_SESSION`, `credsFromEnv`; `applyHomepageVolumes`, `homepageDayWindow`, `AiCell`
- Produces:
  - `export async function refreshHomepageData(deps: HomepageRefreshDeps): Promise<DashboardData>`
  - `export type HomepageRefreshDeps = { readData: () => Promise<DashboardData> | DashboardData; writeData: (data: DashboardData) => Promise<void>; credsFromEnv?: () => SnowflakeCreds; fetchImpl?: FetchImpl; sleep?: ...; now?: () => Date }`
  - `export function homepageRoutes(deps?: HomepageRefreshDeps)` with `POST /api/homepage/refresh` → 200 `{ data }` or 500 `{ error }`
  - Default `readData` / `writeData` use `src/data.json` via `import.meta.url`

Parse Amp totals from rows `[name, count]`. Parse AI cells from `[category, action, event, count]` (empty event → `null`). Build 30-length daily arrays with `0` for missing days using `homepageDayWindow`. Preview names: after a totals-only apply (empty daily maps), `flatMap` repos through `topLiveByVolume(events, 5)`. Then query daily SQL, apply again with series, **then** `writeData`. If any Snowflake call throws, do not call `writeData`.

- [ ] **Step 1: Write the failing tests**

In `src/homepageRefresh.test.ts`:

```ts
test("refreshHomepageData writes only after both rollups succeed", async () => {
  const data: DashboardData = { provenance: "t", repos: [] };
  let written: DashboardData | null = null;
  let calls = 0;
  const fetchImpl: FetchImpl = async () => {
    calls += 1;
    return new Response(JSON.stringify({ data: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  const out = await refreshHomepageData({
    readData: () => data,
    writeData: async (next) => {
      written = next;
    },
    credsFromEnv: () => ({ pat: "tok" }),
    fetchImpl,
    now: () => new Date("2026-08-26T16:00:00Z"),
  });
  expect(written).toBe(out);
  expect(out.volumeAsOf).toBe("2026-08-24");
  expect(out.volumeRefreshedAt).toBe("2026-08-26T16:00:00.000Z");
  expect(calls).toBeGreaterThan(0);
});

test("refreshHomepageData does not write when Snowflake fails", async () => {
  const data: DashboardData = { provenance: "t", repos: [] };
  let wrote = false;
  await expect(
    refreshHomepageData({
      readData: () => data,
      writeData: async () => {
        wrote = true;
      },
      credsFromEnv: () => ({ pat: "tok" }),
      fetchImpl: async () => new Response("nope", { status: 500 }),
      now: () => new Date("2026-08-26T16:00:00Z"),
    }),
  ).rejects.toThrow();
  expect(wrote).toBe(false);
});
```

In `src/homepageApi.test.ts`:

```ts
import { expect, test } from "bun:test";
import { homepageRoutes } from "./homepageApi";
import type { DashboardData } from "./model";

test("POST /api/homepage/refresh returns data on success and 500 without write on error", async () => {
  const seed: DashboardData = { provenance: "t", repos: [] };
  let wrote = false;
  const ok = homepageRoutes({
    readData: () => seed,
    writeData: async () => {
      wrote = true;
    },
    credsFromEnv: () => ({ pat: "tok" }),
    fetchImpl: async () =>
      new Response(JSON.stringify({ data: [] }), { status: 200, headers: { "Content-Type": "application/json" } }),
    now: () => new Date("2026-08-26T16:00:00Z"),
  })["/api/homepage/refresh"].POST;
  const res = await ok();
  expect(res.status).toBe(200);
  const body = (await res.json()) as { data: DashboardData };
  expect(body.data.volumeAsOf).toBe("2026-08-24");
  expect(wrote).toBe(true);

  wrote = false;
  const bad = homepageRoutes({
    readData: () => seed,
    writeData: async () => {
      wrote = true;
    },
    credsFromEnv: () => ({ pat: "tok" }),
    fetchImpl: async () => new Response("nope", { status: 500 }),
    now: () => new Date("2026-08-26T16:00:00Z"),
  })["/api/homepage/refresh"].POST;
  const err = await bad();
  expect(err.status).toBe(500);
  expect(await err.json()).toEqual({ error: expect.any(String) });
  expect(wrote).toBe(false);
});
```

`toEqual({ error: expect.any(String) })` is invalid in bun if `expect.any` is not used that way — assert `typeof (await err.json() as {error: string}).error === "string"` instead.

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/homepageRefresh.test.ts src/homepageApi.test.ts`

Expected: FAIL — `refreshHomepageData` / `homepageRoutes` missing.

- [ ] **Step 3: Minimal implementation**

Implement `refreshHomepageData` to: read → Amp volume + AI volume → `applyHomepageVolumes` with empty daily maps → collect preview names → if names.length, Amp daily (+ AI daily) → parse into `Map<string, number[]>` aligned with `eachUtcDate(window)` → `applyHomepageVolumes` again → `writeData` → return.

Default file helpers:

```ts
const dataUrl = new URL("./data.json", import.meta.url);
export async function readDashboardFile(): Promise<DashboardData> {
  return (await Bun.file(dataUrl).json()) as DashboardData;
}
export async function writeDashboardFile(data: DashboardData): Promise<void> {
  await Bun.write(dataUrl, JSON.stringify(data, null, 2) + "\n");
}
```

`homepageApi.ts`:

```ts
export function homepageRoutes(deps: HomepageRefreshDeps = {}) {
  return {
    "/api/homepage/refresh": {
      async POST() {
        try {
          const data = await refreshHomepageData(deps);
          return Response.json({ data });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return Response.json({ error: message }, { status: 500 });
        }
      },
    },
  };
}
```

In `src/index.tsx` add `...homepageRoutes()` next to `...compareRoutes(db)`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/homepageRefresh.test.ts src/homepageApi.test.ts src/eventCompareApi.test.ts`

Expected: PASS

- [ ] **Step 5: Commit** (skip unless the user asked)

---

### Task 6: Dashboard Refresh, Updated copy, Amp+AI card

**Files:**
- Modify: `src/Dashboard.tsx`
- Modify: `src/App.tsx`
- Create: `src/Dashboard.test.tsx`

**Interfaces:**
- Consumes: `formatUpdatedAgo`; `POST /api/homepage/refresh`; `DashboardData.onData`
- Produces: `Dashboard` props `{ data, onData, theme, onToggleTheme, onTip }` where `onData: (data: DashboardData) => void`

- [ ] **Step 1: Write the failing tests**

```tsx
import { expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import { Dashboard } from "./Dashboard";
import type { DashboardData } from "./model";

const data: DashboardData = {
  provenance: "mapping",
  volumeAsOf: "2026-09-13",
  volumeRefreshedAt: "2026-09-13T00:00:00.000Z",
  repos: [
    {
      repo: "wdesk_sdk",
      events: [],
      counts: { live: 1 },
      total: 1,
      live: 1,
      volume30: 1500,
      volume30Ai: 1600,
      sources: [],
      prs: [],
      inv_mapped: 0,
      inv_unmapped: 0,
    },
  ],
};

test("homepage shows Refresh, Updated copy, and Amp vs AI card totals", () => {
  const html = renderToString(
    <Dashboard
      data={data}
      onData={() => {}}
      theme="light"
      onToggleTheme={() => {}}
      onTip={() => {}}
      now={new Date("2026-09-16T18:00:00Z")}
    />,
  );
  expect(html).toContain("Refresh");
  expect(html).toContain("Updated 3 days ago");
  expect(html).toContain("Amp");
  expect(html).toContain("AI");
  expect(html).toContain("2K");
});
```

Use a `now` prop on Dashboard (default `() => new Date()`) so the copy is deterministic.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/Dashboard.test.tsx`

Expected: FAIL — `onData` / Refresh / Amp-AI labels missing.

- [ ] **Step 3: Minimal implementation**

`App.tsx`: `<Dashboard data={data} onData={setData} ... />`.

`Dashboard.tsx`:
- Add `onData` and optional `now`
- Next to provenance: `{formatUpdatedAgo(data.volumeRefreshedAt ?? data.volumeAsOf ?? "", now())}` when either timestamp exists
- In the Expand/Collapse cluster, add Refresh (same `surf border rounded-md px-2.5 py-1.5 text-[12px] font-medium` as Refresh all). `disabled` while `busy`. `POST /api/homepage/refresh`, then `onData(body.data)`, else set a local `refreshError` string shown under the Updated line in `st-critical-ink`
- Repo card volume block:

```tsx
<span className="shrink-0 text-right w-20 hidden sm:block">
  <span className="block text-[12.5px] tabular-nums font-medium">
    {r.volume30 ? fmt(r.volume30) : "—"}
  </span>
  <span className="block txt-3 text-[10.5px]">Amp</span>
  <span className="block text-[12.5px] tabular-nums font-medium mt-1">
    {r.volume30Ai ? fmt(r.volume30Ai) : "—"}
  </span>
  <span className="block txt-3 text-[10.5px]">AI</span>
</span>
```

Do not change KPI tiles or the progress-bar legend.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/Dashboard.test.tsx src/App.test.ts`

Expected: PASS

- [ ] **Step 5: Commit** (skip unless the user asked)

---

### Task 7: AppSummary grouped Amp / App Intel columns

**Files:**
- Modify: `src/AppSummary.tsx`
- Create: `src/AppSummary.test.tsx`

**Interfaces:**
- Consumes: `series30`, `aiSeries30`, `v30`, `ai30` on `MigrationEvent`
- Produces: two-row header: Event `rowSpan={2}`; **Amplitude** `colSpan={showSpark ? 2 : 1}`; **App Intel** `colSpan={showSpark ? 2 : 1}`. `showSpark` is true when any top-5 row has `series30` or `aiSeries30` length ≥ 2.

- [ ] **Step 1: Write the failing test**

```tsx
import { expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import { AppSummary } from "./AppSummary";
import type { MigrationEvent, RepoRecord } from "./model";

const ev: MigrationEvent = {
  name: "General Experience Loading",
  legacy: ["GeneralExperienceLoadingEventV2"],
  status: "live",
  v30: 1000,
  v365: 1,
  dev30: 0,
  merged: false,
  pr: null,
  amp_count: 1,
  ss_error: "",
  queried: 0,
  series30: [1, 2, 3],
  ai30: 1100,
  aiSeries30: [1, 2, 3],
};

const repo: RepoRecord = {
  repo: "wdesk_sdk",
  events: [ev],
  counts: { live: 1 },
  total: 1,
  live: 1,
  volume30: 1000,
  volume30Ai: 1100,
  sources: [],
  prs: [],
  inv_mapped: 0,
  inv_unmapped: 0,
};

test("AppSummary groups Amplitude and App Intel last-30d columns", () => {
  const html = renderToString(<AppSummary repo={repo} query="" />);
  expect(html).toContain("Amplitude");
  expect(html).toContain("App Intel");
  expect(html).toContain("Last 30d");
  expect(html).toContain("30d vol");
  expect(html).toContain(">1K<");
});
```

If `fmt(1000)` is `"1K"`, assert that. `fmt(1100)` is also `"1K"`.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/AppSummary.test.tsx`

Expected: FAIL — no `App Intel` group header.

- [ ] **Step 3: Minimal implementation**

Two `<tr>` in `<thead>`:

```tsx
const live = topLiveByVolume(repo.events, 5);
const showSpark = live.some(
  (e) => (e.series30?.length ?? 0) >= 2 || (e.aiSeries30?.length ?? 0) >= 2,
);
```

```tsx
<tr>
  <th rowSpan={2} scope="col" className="py-1.5 pr-3 font-semibold">Event</th>
  <th colSpan={showSpark ? 2 : 1} scope="colgroup" className="py-1.5 font-semibold text-center">Amplitude</th>
  <th colSpan={showSpark ? 2 : 1} scope="colgroup" className="py-1.5 font-semibold text-center">App Intel</th>
</tr>
<tr className="txt-3 text-[10.5px] uppercase tracking-wider">
  {showSpark ? <th scope="col" className="py-1.5 pr-2 font-semibold text-right">Last 30d</th> : null}
  <th scope="col" className="py-1.5 pr-3 font-semibold text-right">30d vol</th>
  {showSpark ? <th scope="col" className="py-1.5 pr-2 font-semibold text-right">Last 30d</th> : null}
  <th scope="col" className="py-1.5 font-semibold text-right">30d vol</th>
</tr>
```

Body: Event | Amp sparkline or — | `fmt(ev.v30)` | AI sparkline or — | `ev.ai30 == null ? "—" : fmt(ev.ai30)`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/AppSummary.test.tsx src/Dashboard.test.tsx`

Expected: PASS

- [ ] **Step 5: Commit** (skip unless the user asked)

---

### Task 8: Seed identities into `data.json` and verify the suite

**Files:**
- Modify: `src/data.json` (identities only; do not invent volumes)
- Modify: `scripts/seed-ai-identities.ts` (create)

**Interfaces:**
- Consumes: `seedAiIdentities`, `readDashboardFile` / `writeDashboardFile` or `Bun.file`
- Produces: `wdesk_sdk` live events in `data.json` have `aiCategory`/`aiAction` (and `aiEvent` / `aiEventExclude` where required). Other repos unchanged unless `identityFromLegacy` matches.

- [ ] **Step 1: Write a failing assertion**

```ts
import { expect, test } from "bun:test";
import data from "./data.json";
import { contractFor } from "./eventCompare";

test("wdesk_sdk GEL and Shell Generic Analytic carry App Intel identities", () => {
  const sdk = data.repos.find((r) => r.repo === "wdesk_sdk")!;
  const gel = sdk.events.find((e) => e.name === "General Experience Loading")!;
  const shell = sdk.events.find((e) => e.name === "Shell Generic Analytic")!;
  expect(gel.aiCategory).toBe("general");
  expect(gel.aiAction).toBe("experience-loading");
  expect(shell.aiEventExclude).toEqual(contractFor("Shell Generic Analytic")!.aiEventExclude);
});
```

Put this in `src/homepageVolumes.test.ts` or `src/dataIdentities.test.ts`. It should fail until `data.json` is seeded.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/dataIdentities.test.ts`

Expected: FAIL — `aiCategory` undefined.

- [ ] **Step 3: Seed script and run it**

`scripts/seed-ai-identities.ts`:

```ts
import { seedAiIdentities } from "../src/homepageVolumes";
import type { DashboardData } from "../src/model";

const dataPath = new URL("../src/data.json", import.meta.url);
const data = (await Bun.file(dataPath).json()) as DashboardData;
await Bun.write(dataPath, JSON.stringify(seedAiIdentities(data), null, 2) + "\n");
```

Run: `bun scripts/seed-ai-identities.ts`

- [ ] **Step 4: Run the full suite**

Run: `bun test`

Expected: all tests PASS, including the identity assertion.

- [ ] **Step 5: Commit** (skip unless the user asked)

---

## Self-review

| Spec requirement | Task |
|---|---|
| POST homepage refresh writes `data.json` | 5 |
| Snowflake Amp + AI, 30d ending today−2 | 1, 4, 5 |
| `volumeRefreshedAt` / Updated N days ago | 1, 3, 6 |
| KPIs/progress Amp-only | 6 (no tile changes) |
| Repo card Amp + AI | 6 |
| AppSummary grouped headers + AI Last 30d / 30d vol | 7 |
| Top 5 still Amp-live | 3, 7 |
| Identities seed from contracts + shell pattern | 2, 8 |
| Unmapped AI null / em dash | 2, 3, 7 |
| No write on Snowflake error | 5 |
| App Detail 30d unchanged | (no task; leave `AppDetail.tsx`) |
| No Amplitude Dashboard API | 5 uses Snowflake only |
| `idleTimeout` already 0 | no change |

No TBD placeholders. Types use `ai30`, `volume30Ai`, `volumeRefreshedAt`, `homepageDayWindow`, `applyHomepageVolumes`, `refreshHomepageData` consistently.
