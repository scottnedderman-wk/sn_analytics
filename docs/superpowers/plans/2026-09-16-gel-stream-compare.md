# GEL Stream Compare Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Point Event Compare refresh and Inspect at the 2026-09-15 GEL stream contract (`SILVER_PROD.ADMIN.USER_ANALYTIC` vs Amplitude mart), bound windows at 2 UTC days ago, and score volume only on days present on both sides.

**Architecture:** Keep the existing Inspect/cache/HTTP shape. Update the GEL contract, Snowflake session (warehouse per stream), volume SQL (daily + overlap), and modal copy. Scores stay computed in process from the snapshot.

**Tech Stack:** Bun, TypeScript, React 19, `bun:test`, `bun:sqlite`, Snowflake SQL API.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-09-15-gel-stream-compare.md`
- Window: 7 UTC days ending **today − 2** (ingest lag). Do not use yesterday.
- App Intel: `SILVER_PROD.ADMIN.USER_ANALYTIC`, `PROD_SILVER_LARGE_DBT_WAREHOUSE`, `TECH_ANALYST`
- App Intel time: `TRY_TO_TIMESTAMP(dimensions:timestamp::VARCHAR)::DATE` — never top-level `timestamp` or `event_timestamp`
- App Intel event filter: `category = 'general'` AND `action = 'experience-loading'`
- Amplitude: `gold_prod.marts.fct_amplitude_events`, `PROD_WH`, `source_event_type = 'General Experience Loading'`, `is_amplitude_generated_event = FALSE`
- Envs: Amplitude `us/eu/apac` ↔ App Intel `production/prod-eu/prod-apac`
- Do not use `silver_prod.user_analytic.general_experience_loading`
- Do not row-join `guid` to Amplitude ids
- `bun test` only; no live Snowflake in tests
- Comparable fields: the eight in the spec (page URL + host included). Omit `experience_name`/`experienceName`, `session_id`, `page_location`, `page_path`. Do not score device/geo/`app` (Amplitude GEL dual-write is only `value` + `experienceName`; `app` is not a dual-write GEL field).

## File map

| File | Responsibility |
|---|---|
| `src/eventCompare.ts` | Lagged window, overlap volume, GEL contract (table + `dimensions` paths + 8 fields) |
| `src/snowflakeEvents.ts` | Optional statement session (warehouse/database/schema) |
| `src/eventCompareRefresh.ts` | Daily volume SQL, AI filters, per-stream session, overlap totals |
| `src/eventCompareCache.ts` | Snapshot `daily` array (optional, version 1 still) |
| `src/EventCompareModal.tsx` | New column names, omitted notes, daily volume table, `80vw` |

---

### Task 1: Lagged window and overlap volume

**Files:** Modify `src/eventCompare.ts`, `src/eventCompare.test.ts`

- [ ] Fail then pass: `closedDayWindow(2026-08-26T16:00:00Z)` → `{ start: "2026-08-18", end: "2026-08-24" }`
- [ ] Fail then pass: `overlapVolume` sums only days with both `ai` and `amp` non-null; empty overlap → `null`

### Task 2: GEL contract on ADMIN.USER_ANALYTIC

**Files:** Modify `src/eventCompare.ts`, tests

- [ ] `aiTable` is `SILVER_PROD.ADMIN.USER_ANALYTIC`
- [ ] `aiDateExpr`, `aiCategory`, `aiAction` on the contract
- [ ] 8 fields with `dimensions:*` paths; duration top-level `value` VARIANT INTEGER; event_time VARCHAR ISO vs DATE
- [ ] `typesCompatible` treats event_time VARCHAR as date-like vs DATE/TIMESTAMP
- [ ] omitted includes page_location and page_path

### Task 3: Snowflake session override

**Files:** Modify `src/snowflakeEvents.ts`, `src/snowflakeEvents.test.ts`

- [ ] `executeStatement` defaults to `PROD_WH` / `GOLD_PROD` / `MARTS`
- [ ] `deps.session` can set App Intel warehouse `PROD_SILVER_LARGE_DBT_WAREHOUSE`, database `SILVER_PROD`, schema `ADMIN`

### Task 4: Refresh SQL and daily merge

**Files:** Modify `src/eventCompareRefresh.ts`, tests

- [ ] Amplitude volume SQL groups by `event_date`
- [ ] App Intel volume/fill uses `aiDateExpr`, category/action, `USER_ANALYTIC`
- [ ] Fill COUNT uses `dimensions:` paths; duration still `COUNT(value)` / `TRY_TO_DOUBLE`
- [ ] Refresh runs Amp queries on default session, AI queries on large warehouse
- [ ] Snapshot `volume` is overlap totals when both sides succeed; daily series stored
- [ ] AI 408 still keeps Amplitude data; volume part pending

### Task 5: Inspect modal

**Files:** Modify `src/EventCompareModal.tsx`, `src/EventCompareModal.test.tsx`

- [ ] Shows `dimensions:timestamp`, `dimensions:url`, `page_url`, `page_domain`, `page_location`, `page_path`
- [ ] Daily volume rows when snapshot.daily present
- [ ] Dialog `w-[80vw]`, no `max-w-3xl`

Run: `bun test src/eventCompare.test.ts src/eventCompareRefresh.test.ts src/snowflakeEvents.test.ts src/EventCompareModal.test.ts src/eventCompareApi.test.ts src/eventCompareCache.test.ts src/AppDetail.test.tsx`
