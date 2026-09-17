# Homepage Amp vs App Intel 30d volumes — design

Date: 2026-09-16

## Goal

Let a person refresh homepage 30-day event counts from the UI. Counts come from Snowflake for **Amplitude** and **App Intel**, are written back to `src/data.json`, and are shown as separate Amp vs AI numbers. Migration KPIs and the colored progress bar stay Amplitude-only.

## Non-goals

- Changing Live / Stale / Blocked / Not seen meaning, or scoring KPIs from App Intel volume
- Event Compare contracts, Match %, or Inspect
- Splitting App Detail’s 30d volume column into Amp vs AI (follow-up)
- Calling the Amplitude Dashboard API (`amplitude-refresh-30d` stays as a CLI; homepage Refresh does not use it)
- Inventing App Intel identities at refresh time (no Sourcegraph/GitHub from the server)
- Live Snowflake in `bun test`
- SQLite cache for homepage volumes (rejected; `data.json` is the store)

## Architecture

```
Dashboard
  Refresh · Updated N days ago
  KPIs / progress bar          ← Amplitude only
  Repo card Amp 30d + AI 30d
  AppSummary grouped Amp | AI
        │
        ▼
POST /api/homepage/refresh
        │
        ├─ read src/data.json
        ├─ Snowflake Amp rollup (PROD_WH)
        ├─ Snowflake AI rollup  (PROD_SILVER_LARGE_DBT_WAREHOUSE)
        ├─ daily series for top-5 Amp-live names per app
        ├─ merge → write src/data.json
        └─ return DashboardData
```

Page load still `GET /data.json`. A successful refresh returns the full payload; the client replaces dashboard state in memory. The written file is what the next reload sees.

`Bun.serve` `idleTimeout` is already `0` so this long POST is not reset as browser `Failed to fetch`.

## Defaults (locked)

| Item | Value |
|---|---|
| Window | 30 closed UTC days ending today − `INGEST_LAG_DAYS` (2) |
| Amplitude table | `gold_prod.marts.fct_amplitude_events` |
| App Intel table | `SILVER_PROD.ADMIN.USER_ANALYTIC` |
| Amp date | `event_date` |
| AI date | `TRY_TO_TIMESTAMP(dimensions:timestamp::VARCHAR)::DATE` |
| Amp filter | `is_amplitude_generated_event = FALSE`, env `us` / `eu` / `apac` |
| AI filter | env `production` / `prod-eu` / `prod-apac` |
| Role | `TECH_ANALYST` |
| Auth | `SNOWFLAKE_PAT` |
| Store | overwrite `src/data.json` (pretty-printed JSON + trailing newline, same as the CLI) |
| Status / KPIs / progress / top-5 row pick | Amplitude `v30` only |
| Unmapped AI | `null` → em dash |

## Data shape

Keep existing Amplitude fields: `v30`, `series30`, `volume30`, `volumeAsOf`, `volumeWindowDays`.

Add:

| Field | Where | Meaning |
|---|---|---|
| `aiCategory` | event | App Intel `category` |
| `aiAction` | event | App Intel `action` |
| `aiEvent` | event | optional `dimensions:event` equality filter |
| `aiEventExclude` | event | optional exact `dimensions:event` values to exclude (plus the progress/notification/createMenuItem `LIKE` patterns used by Event Compare) |
| `ai30` | event | App Intel count in the window; `null` if no identity |
| `aiSeries30` | event | daily AI counts aligned to the 30-day window; omitted unless fetched for a top-5 row |
| `volume30Ai` | repo | sum of non-null `ai30` |
| `volumeRefreshedAt` | root | ISO timestamp of last **successful** homepage refresh |

`volumeAsOf` remains the window **end** date (`YYYY-MM-DD`). Footer keeps “Volume comes from … ending `volumeAsOf`”. Header **Updated N days ago** uses `volumeRefreshedAt` when present, otherwise `volumeAsOf` at 00:00 UTC, so current `data.json` still shows a date before the first new refresh.

Relative copy: 0 → “Updated today”; 1 → “Updated yesterday”; N → “Updated N days ago”.

`applyHomepageVolumes` must:

- Set `v30` from Amp totals by exact `event.name` (missing name → 0)
- Recompute Amplitude `status` with existing `statusAfterVolume` (AI must not change status)
- Set `ai30` from AI totals by identity; no identity → `ai30: null` (not 0)
- Recount `volume30` (sum `v30`) and `volume30Ai` (sum of non-null `ai30`)
- Attach `series30` / `aiSeries30` only onto the preview names requested after totals exist
- Set `volumeAsOf`, `volumeWindowDays: 30`, `volumeRefreshedAt`

## App Intel identity

Identities are stored on events in `data.json`. Refresh only joins.

Match order for an event that has `aiCategory` + `aiAction`:

1. If `aiEvent` is set: that `(category, action, event)` cell only
2. Else if `aiEventExclude` is set: sum cells for that category/action whose event is not in the exclude list and not `LIKE 'progressItem.%'`, `'notificationItem.%'`, `'createMenuItem.%'`
3. Else: sum all event values for that category/action (dedicated 1:1)

Named shell slices and the Shell Generic Analytic remainder must not double-count.

**Populate identities once (not on each Refresh):**

1. Copy Event Compare contracts onto matching `event.name` (including Shell remainder excludes).
2. Same-repo pattern: `legacy` contains `ShellGenericAnalyticEventV2` plus a camelCase token → `shell` / `generic-analytic` / that token.
3. Discovery pass from generated App Intel classes: legacy class → `category` / `action`. Write the results into `data.json`. The server refresh path does not call Sourcegraph.
4. Still no identity → AI columns em dash. Amp still fills by name for every mapped event.

## Snowflake rollups

Totals (all mapped names / all identities in one statement each):

- Amp: `SELECT source_event_type, COUNT(*) … GROUP BY 1`
- AI: `SELECT category, action, dimensions:event::VARCHAR AS ev, COUNT(*) … GROUP BY 1, 2, 3`

Then, after top-5 Amp-live names per app are known, daily series for **those names only**:

- Amp: `SELECT source_event_type, event_date, COUNT(*) … GROUP BY 1, 2`
- AI: same grain as the totals query plus date, filtered to identities of the preview names

Daily arrays are 30 entries, window-aligned, missing days `0` (Amp) or `0` when the event has identity (AI). Do not write AI series for events with no identity.

Reuse `executeStatement` and `AI_STATEMENT_SESSION` / default Amp session.

## HTTP

`POST /api/homepage/refresh`

- 200 `{ data: DashboardData }` after a successful write
- 500 `{ error }` on missing PAT, Snowflake failure, or write failure; **do not** write a partial `data.json`
- No GET cache besides `/data.json`

## UI

**Header:** Refresh control next to Expand/Collapse (same visual language as app-detail Refresh all). Disabled + busy while the POST is in flight. **Updated N days ago** next to provenance. On failure, a short error line there; dashboard data stays on the last successful payload.

**KPIs and progress bar:** unchanged, Amplitude-only.

**Repo cards:** existing Amp 30d figure labeled **Amp**; second line **AI** with `fmt(volume30Ai)` or em dash.

**AppSummary:** still `topLiveByVolume` (Amp live by `v30`, limit 5). Two header rows: Event `rowSpan=2`; group **Amplitude** and **App Intel** each spanning Last 30d + 30d vol. Amp sparkline from `series30`; AI sparkline from `aiSeries30`. Empty series → em dash. If neither side has a series of length ≥ 2, omit both Last 30d columns.

App Detail 30d volume stays a single Amplitude number.

## Errors

Snowflake or disk errors abort the merge. The previous `data.json` remains the source of truth. The client shows `error` and does not apply a partial body.

## Tests (no live Snowflake)

- Window is 30 UTC days ending 2 days ago
- Amp SQL groups by `source_event_type` with mapped envs and generated-event filter
- AI SQL groups by category, action, event with mapped envs and `dimensions:timestamp` date
- Join: dedicated category/action, named `aiEvent`, remainder `aiEventExclude` + `LIKE` patterns, no double-count
- `applyHomepageVolumes` updates Amp/AI volumes and `volumeAsOf` / `volumeRefreshedAt`; AI does not change status; missing Amp name is 0; missing AI identity is `null`
- Refresh handler writes the file on success and leaves it unchanged on Snowflake error
- Dashboard: Refresh button; Updated copy; Amp+AI on the card; AppSummary grouped headers and extra AI columns

## Out of scope follow-ups

- App Detail Amp vs AI 30d columns
- Removing `bun run amplitude-refresh-30d`
- Filling remaining App Intel identities after the first discovery pass
