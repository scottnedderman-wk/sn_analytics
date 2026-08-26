# Event Compare Page Fields Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Widen the Inspect dialog to 80% of the viewport and add GEL Page URL (`url`↔`page_url`) and Host (`host`↔`page_domain`), with `page_location` and `page_path` listed as not compared.

**Architecture:** Extend the existing static `GEL_CONTRACT` in `src/eventCompare.ts`. Fill SQL already `COUNT`s each contract field, so refresh needs no new builders—only a longer fake fill row in tests. The modal reads the contract; width is a className change.

**Tech Stack:** Bun, TypeScript, React 19, `bun:test`. No new packages. No live Snowflake in tests.

## Global Constraints

- Use Bun (`bun test`, `bun <file>`); Bun loads `.env` (no dotenv)
- Spec: `docs/superpowers/specs/2026-08-26-event-compare-page-fields-design.md` (amends the 2026-08-26 inspect spec)
- Do not change Live / 30d volume / GitHub / header `% live` meaning
- Do not query Snowflake on page load or modal open
- Do not compare exact values, `experience_name` vs `experienceName`, or session IDs
- Do not score `page_location` or `page_path`; do not derive App Intel path via `PARSE_URL`
- Do not add device/OS, referrer, or previous-page properties
- Closed-day window, populated floor, env map, failed-refresh cache behavior: unchanged
- Tests must not call the network
- Only stage files for this feature; do not commit `.env`
- Commit after each task if the user has not forbidden commits for this work; skip commits if they asked not to commit
- Stay on branch `event-compare-page-fields`; do not switch to master

## File map

| File | Responsibility |
|---|---|
| `src/eventCompare.ts` | `FieldKey`, `gelFields`, `GEL_CONTRACT.omitted` |
| `src/eventCompare.test.ts` | Eight-field contract + omitted names |
| `src/eventCompareRefresh.test.ts` | Fill SQL / fake fill row of `n` + 8 counts |
| `src/EventCompareModal.tsx` | Dialog `w-[80vw]`; omitted list comes from contract |
| `src/EventCompareModal.test.tsx` | New columns, omitted names, `80vw` class |

---

### Task 1: GEL page URL and host on the contract

**Files:**
- Modify: `src/eventCompare.ts`
- Modify: `src/eventCompare.test.ts`
- Modify: `src/eventCompareRefresh.test.ts`

**Interfaces:**
- Consumes: existing `ContractField`, `GEL_CONTRACT`, `ampFillSql` / `aiFillSql` (they already map `contract.fields`)
- Produces:
  - `FieldKey` includes `"page_url" | "host"`
  - `GEL_CONTRACT.fields` length 8, last two: Page URL (`url` / `page_url`) and Host (`host` / `page_domain`), both `present: true`, `typeCompatible: true`
  - `GEL_CONTRACT.omitted` keeps the two existing entries and appends `page_location` and `page_path` with the spec reasons

- [ ] **Step 1: Write the failing tests**

In `src/eventCompare.test.ts`, change the GEL registry test to:

```ts
test("GEL contract is registered for wdesk_sdk", () => {
  const c = contractFor("General Experience Loading");
  expect(c?.repo).toBe("wdesk_sdk");
  expect(c?.fields).toHaveLength(8);
  expect(c?.fields.map((f) => f.key)).toEqual([
    "event_time",
    "user",
    "organization",
    "workspace",
    "duration",
    "environment",
    "page_url",
    "host",
  ]);
  expect(c?.fields.find((f) => f.key === "page_url")).toMatchObject({
    aiColumn: "url",
    ampColumn: "page_url",
    present: true,
    typeCompatible: true,
  });
  expect(c?.fields.find((f) => f.key === "host")).toMatchObject({
    aiColumn: "host",
    ampColumn: "page_domain",
    present: true,
    typeCompatible: true,
  });
  expect(c?.omitted.map((o) => o.name)).toEqual([
    "experience_name vs experienceName",
    "session_id",
    "page_location",
    "page_path",
  ]);
  expect(contractsForRepo("wdesk_sdk").map((x) => x.eventName)).toEqual(["General Experience Loading"]);
  expect(contractsForRepo("w_outline")).toEqual([]);
});
```

In `src/eventCompareRefresh.test.ts`, add the import of `ampFillSql` if missing, keep `ampVolumeSql` as-is, and:

1. Change the App Intel 408 fill row from 7 cells to 9 (`COUNT(*)` plus eight fields), in contract field order:

```ts
data: [["100", "100", "90", "90", "90", "80", "100", "100", "100"]],
```

2. Add:

```ts
test("ampFillSql counts all eight GEL amp columns", () => {
  const sql = ampFillSql(GEL_CONTRACT, window);
  expect(sql).toContain("COUNT(*) AS n");
  expect(sql).toContain("COUNT(page_url)");
  expect(sql).toContain("COUNT(page_domain)");
  expect(sql).toContain("COUNT(TRY_TO_DOUBLE(raw_event_properties:value::STRING))");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/eventCompare.test.ts src/eventCompareRefresh.test.ts`

Expected: FAIL — field length still 6 and/or omitted names missing `page_location`

- [ ] **Step 3: Write minimal implementation**

In `src/eventCompare.ts`, change `FieldKey` to:

```ts
export type FieldKey =
  | "event_time"
  | "user"
  | "organization"
  | "workspace"
  | "duration"
  | "environment"
  | "page_url"
  | "host";
```

Append to `gelFields` (after environment):

```ts
  { key: "page_url", label: "Page URL", aiColumn: "url", aiType: "VARCHAR", ampColumn: "page_url", ampType: "VARCHAR", present: true, typeCompatible: true },
  { key: "host", label: "Host", aiColumn: "host", aiType: "VARCHAR", ampColumn: "page_domain", ampType: "VARCHAR", present: true, typeCompatible: true },
```

Append to `GEL_CONTRACT.omitted` (keep the existing two objects first):

```ts
    { name: "page_location", reason: "Same as Amplitude page_url for this event; do not score it twice." },
    { name: "page_path", reason: "Amplitude pathname only. App Intel has no path column; path is implied by url." },
```

Do not change `ampCountExpr` / `aiCountExpr`; duration stays the only special case. `url` / `page_url` / `host` / `page_domain` use `COUNT(column)`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/eventCompare.test.ts src/eventCompareRefresh.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/eventCompare.ts src/eventCompare.test.ts src/eventCompareRefresh.test.ts
git commit -m "$(cat <<'EOF'
Add GEL page URL and host to the compare contract.

EOF
)"
```

---

### Task 2: Wider inspect modal

**Files:**
- Modify: `src/EventCompareModal.tsx`
- Modify: `src/EventCompareModal.test.tsx`

**Interfaces:**
- Consumes: `GEL_CONTRACT` from Task 1 (`compareRowFromContract` already lists contract fields and `omitted`)
- Produces: dialog element uses `w-[80vw]` and does not use `max-w-3xl`

- [ ] **Step 1: Write the failing test**

Replace `src/EventCompareModal.test.tsx` with:

```ts
import { expect, test } from "bun:test";
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
  expect(html).toContain("page_url");
  expect(html).toContain("page_domain");
  expect(html).toContain(">url VARCHAR<");
  expect(html).toContain(">host VARCHAR<");
  expect(html).toContain("Populated");
  expect(html).toContain("pending");
  expect(html).toContain("experience_name");
  expect(html).toContain("page_location");
  expect(html).toContain("page_path");
  expect(html).toContain("w-[80vw]");
  expect(html).not.toContain("max-w-3xl");
  expect(html).not.toContain("same event instance");
});
```

If `>url VARCHAR<` does not match because of extra whitespace/classes, assert `toContain("url VARCHAR")` and `toContain("host VARCHAR")` instead (the cells are `{f.aiColumn} {f.aiType}`).

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/EventCompareModal.test.tsx`

Expected: FAIL — missing `page_url` / `w-[80vw]` until Task 1 is on this branch; after Task 1, FAIL on `w-[80vw]` / `max-w-3xl`

- [ ] **Step 3: Write minimal implementation**

In `src/EventCompareModal.tsx`, change the dialog `div` `className` from:

```
surf border rounded-lg fixed z-50 inset-x-4 top-8 mx-auto max-w-3xl max-h-[calc(100vh-4rem)] overflow-y-auto p-5 outline-none
```

to:

```
surf border rounded-lg fixed z-50 top-8 left-1/2 -translate-x-1/2 w-[80vw] max-h-[calc(100vh-4rem)] overflow-y-auto p-5 outline-none
```

Do not change overlay, chips, table markup, or score logic. Omitted rows already come from `contract.omitted`.

- [ ] **Step 4: Run tests**

Run: `bun test src/EventCompareModal.test.tsx src/eventCompare.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/EventCompareModal.tsx src/EventCompareModal.test.tsx
git commit -m "$(cat <<'EOF'
Widen the inspect modal and show GEL page fields.

EOF
)"
```

- [ ] **Step 6: Browser check**

Run: `bun dev` (or use the existing server). Open `http://localhost:3000/app/wdesk_sdk`. Inspect GEL. Confirm: dialog is ~80% of the window, comparable table includes Page URL (`url` / `page_url`) and Host (`host` / `page_domain`), Not compared lists `page_location` and `page_path`, Escape still closes, header `% live` unchanged. Do not require Snowflake success.

---

## Spec coverage (self-review)

| Spec section | Task |
|---|---|
| Modal width 80vw, drop `max-w-3xl` | 2 |
| Page URL `url`↔`page_url` | 1 |
| Host `host`↔`page_domain` | 1 |
| `FieldKey` includes `page_url` \| `host` | 1 |
| Fill SQL `COUNT(column)` for new fields | 1 (existing builders) |
| Omit `page_location` and `page_path` | 1 (contract) + 2 (modal lists omitted) |
| Keep experience_name / session_id omitted | 1 |
| No device/OS/referrer/previous-page | 1 (not added) |
| Eight fields; Present/Type still 100% | 1 (`scoreParts` uses contract) |
| Tests: contract, modal HTML, fill row | 1, 2 |
| No `% live` / Live / volume / GitHub change | neither task touches those |
| No `PARSE_URL` / scoring `page_location` | neither task |

No placeholders. Types: `page_url` and `host` on `FieldKey` in Task 1; Task 2 only reads the contract.
