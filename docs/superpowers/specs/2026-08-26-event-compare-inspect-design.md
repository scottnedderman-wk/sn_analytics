# Event compare inspect UI — design

Date: 2026-08-26

## Goal

On `/app/:repo` (for example `/app/wdesk_sdk`), let a person inspect how well an Amplitude event matches its App Intel counterpart in Snowflake. Each event row shows a composite match percentage and an Inspect action. Inspect opens a modal of **safe-to-compare** attributes only. Snowflake is queried only from explicit refresh actions; page load reads a SQLite cache.

General Experience Loading is the first event with a filled-in contract (from the 2026-08-25/26 Snowflake + mapping work). Other events use the same UI with pending chips until their contracts and refreshes exist.

## Non-goals

- Exact value comparison between destinations (no joining `guid` to Amplitude `uuid`, no claiming two rows are the same event instance)
- Comparing `experience_name` to Amplitude `experienceName`, or App Intel `session_id` to Amplitude `session_id`
- Deep-link URL (`?inspect=`); modal only
- Expanding rows in place
- Changing the existing migration-status meaning of Live / 30d volume / GitHub / header `% live`
- Querying Snowflake on page load or modal open
- Access to `LAKE_PROD` (still blocked for `TECH_ANALYST`); App Intel volume and populated rates stay pending until that is fixed
- Live Snowflake in `bun test`

## Architecture

```
AppDetail (repo table)
  Match % | Refresh event | Inspect
        │                    │
        │                    ▼
        │              EventCompareModal  ← cache only
        ▼
POST /api/compare/:repo/refresh
POST /api/compare/:repo/events/:eventName/refresh
        │
        ▼
src/eventCompare.ts  (contracts, score, snapshot types)
        │
        ├─ SQLite  event_compare  (cache)
        └─ Snowflake SQL API      (refresh only, existing executeStatement)
GET  /api/compare/:repo  → cache for all events in that repo
```

Page load of `/app/:repo` fetches `/data.json` as today, then `GET /api/compare/:repo` to overlay Match % and last-refresh metadata. The client keeps that overlay in memory. A successful or failed POST refresh returns the affected event row(s); the client merges them into the overlay. Inspect never fetches Snowflake and does not need a second GET.

## Defaults (locked)

| Item | Value |
|---|---|
| Modal | Overlay dialog; Escape and Close dismiss; no URL change |
| Row actions (right →) | Match % · Refresh this event · Inspect |
| Inspect icon | Existing `MagnifyIcon` |
| Refresh icons | Distinct from Inspect (arrow/rotate, not magnifier) |
| Cache | SQLite table in the existing app DB (`SQLITE_PATH` / `./data/app.sqlite`) |
| Snowflake | Only on Refresh all / Refresh this event |
| Failed refresh | Keep last good snapshot; store `last_error`; show it in the header/modal |
| Closed-day window | Last 7 UTC days **excluding today** |
| Env map (GEL) | Amplitude `us`↔App Intel `production`; `eu`↔`prod-eu`; `apac`↔`prod-apac`. Drop Amplitude `ca` and null env. Drop App Intel `sandbox`. |
| Populated floor | A side is populated for a field when non-null rate ≥ 50% in the window |
| Type compatibility | See Type/format rules below |
| First contract | General Experience Loading |

## Score

Four parts. Each part is `null` (pending) or an integer 0–100. **Row Match %** is the integer average of the parts that are not pending. If every part is pending, Match is an em dash.

Hover (and modal chips) list every part by name, including pending.

### Present

Of the event’s comparable-field contract, share of fields that have a column on **both** sides.

`present = round(100 * both / contract.length)`

### Type/format

Of fields present on both sides, share whose types are compatible per the rules below.

`type = round(100 * compatible / both)` — pending if `both === 0`

### Populated

Of fields present on both sides, share that are populated on **both** sides (each side’s non-null rate ≥ 50%). Fill rates are shown in the modal even when below the floor; the boolean only affects this part of the score.

Pending until a successful refresh has stored fill rates.

### Volume

After the env map, let `ai` and `amp` be total event counts over the closed-day window.

- Pending if either total is missing
- `0` if one total is 0 and the other is not
- `100` if both are 0
- Otherwise `round(100 * min(ai, amp) / max(ai, amp))`

No per-row value matching.

### Type/format rules

| App Intel | Amplitude | Compatible |
|---|---|---|
| DATE or TIMESTAMP\* | DATE or TIMESTAMP\* | Yes (compare as UTC calendar dates) |
| VARCHAR / STRING | VARCHAR / STRING | Yes |
| FLOAT / NUMBER / DOUBLE | numeric JSON (`raw_event_properties:value`) or NUMBER | Yes |
| App Intel env `production` / `prod-eu` / `prod-apac` | Amplitude env `us` / `eu` / `apac` | Yes (mapped regions, not raw equality) |
| Anything else | Anything else | No |

## Event row

Keep existing columns: New event, Legacy, Status, 30d volume, Usage, GitHub.

Add:

| Column | Content |
|---|---|
| Match | Tabular % using existing `pctColor` (100 green, ≥70 default, else red). Title: `Present 100% · Type 100% · Populated pending · Volume pending`. Em dash if no parts. |
| Refresh | Icon button, `aria-label="Refresh comparison for {event name}"`. Disabled while that event’s refresh is in flight. |
| Inspect | Icon button (`MagnifyIcon`), `aria-label="Inspect {event name}"`. |

Template-named rows still get Inspect. Match is an em dash until a contract exists.

## Repo header

Next to the existing completion block:

- **Refresh all** — POST refresh for every event in this repo that has a contract. Disabled while any refresh for this repo is in flight. Label stays “Refresh all” (no spinner text requirement beyond `disabled` + a busy attribute).
- **Last refreshed** — timestamp of the most recent *successful* snapshot in the repo, or “Never” if none. If the latest attempt failed, show the last success time plus a short error (do not clear Match %).

## Modal

No URL change. Focus moves into the dialog; Escape and Close restore it.

**Header:** Amplitude event name; legacy name(s) as subtitle; composite Match % with `pctColor`.

**Body, in order:**

1. **Score chips** — Present, Type/format, Populated, Volume. Each is `N%` or `pending`. This is the only numeric summary. Copy must not claim two warehouse rows are the same instance.

2. **Volume** — Table or two stats: App Intel count vs Amplitude count for the closed-day window, after env map, plus last successful refresh time. If App Intel is pending, show Amplitude if we have it and App Intel as pending. Do not invent a gap percentage when one side is pending.

3. **Comparable fields** — one row per contract field:

   | Field | App Intel | Amplitude | Present | Type/format | Populated |

   App Intel / Amplitude cells are **column name and type** (example: `analytic_date DATE` vs `event_date DATE`), not sample values. Present and Type/format are yes/no (or pending). Populated is fill rate per side (`87%` / `91%`) or pending.

4. **Not compared** — collapsed by default. Lists omitted fields and why (GEL: `experience_name` vs `experienceName`; `session_id`).

GEL can open immediately from the static contract even with no cache row (Present + Type filled from DESCRIBE/mapping; Populated and Volume pending).

## GEL comparable-field contract

| Field | App Intel | Amplitude |
|---|---|---|
| Event time | `analytic_date` DATE (also `event_timestamp` TIMESTAMP_NTZ) | `event_date` DATE (`event_timestamp` TIMESTAMP_NTZ) |
| User | `user_resource_id` VARCHAR | `user_resource_id` VARCHAR |
| Organization | `organization_id` VARCHAR | `organization_id` VARCHAR |
| Workspace | `account_resource_id` VARCHAR | `workspace_id` VARCHAR |
| Duration | `value` FLOAT | `raw_event_properties:value` (numeric) |
| Environment | `environment` VARCHAR (`production` / `prod-eu` / `prod-apac`) | `environment` VARCHAR (`us` / `eu` / `apac`) |

App Intel destination: `silver_prod.user_analytic.general_experience_loading` (a **view** over lake; scans currently time out). Amplitude destination: `gold_prod.marts.fct_amplitude_events` where `source_event_type = 'General Experience Loading'` and `is_amplitude_generated_event = FALSE`.

## Cache (SQLite)

Extend `openAppDatabase` to create:

```sql
CREATE TABLE IF NOT EXISTS event_compare (
  repo TEXT NOT NULL,
  event_name TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  refreshed_at TEXT,
  last_error TEXT,
  PRIMARY KEY (repo, event_name)
)
```

`snapshot_json` is a versioned object:

```ts
{
  version: 1,
  window: { start: "YYYY-MM-DD", end: "YYYY-MM-DD" }, // inclusive closed days
  volume: { ai: number | null, amp: number | null },
  fields: Array<{
    key: string,           // "event_time" | "user" | ...
    aiColumn: string,
    aiType: string,
    ampColumn: string,
    ampType: string,
    present: boolean,
    typeCompatible: boolean,
    aiFill: number | null, // 0–1, null pending
    ampFill: number | null
  }>
}
```

Scores are **computed in process** from the contract + snapshot (not stored separately), so formula changes do not require a cache migration.

## HTTP API

| Method | Path | Behavior |
|---|---|---|
| GET | `/api/compare/:repo` | All cache rows for that repo + computed scores. Never Snowflake. |
| POST | `/api/compare/:repo/refresh` | Refresh every contracted event for the repo. Sequential (one Snowflake statement at a time). |
| POST | `/api/compare/:repo/events/:eventName/refresh` | Refresh one event. `eventName` is URL-encoded (`General%20Experience%20Loading`). |

POST always returns HTTP 200 with the affected overlay row(s) so the UI can merge without treating a warehouse timeout as a missing route. On Snowflake timeout/error: set `last_error` and leave `snapshot_json` unchanged if a snapshot existed; if none existed, insert a snapshot that still includes contract columns/types (so Present and Type can score) with volume and fill rates null.

Refresh handlers reuse `executeStatement` / `credsFromEnv`. Timeout remains 120s unless a later change raises it for App Intel.

## UI states

| State | Match | Modal volume/populated | Refresh |
|---|---|---|---|
| No contract | — | Chips pending; fields empty | Disabled |
| Contract, never refreshed | Present + Type only | Volume/populated pending | Enabled |
| Refresh in flight | Unchanged | Unchanged | Disabled |
| Refresh failed | Last scores | Last snapshot + error text | Enabled |
| Refresh succeeded | All available parts | Filled from snapshot | Enabled |

## Testing

`bun test` only. No network.

- Score helper: pending parts excluded from average; volume formula; populated floor 50%; env-mapped volume uses mapped totals only
- Cache: insert/read/preserve snapshot on error
- Overlay merge onto `MigrationEvent` does not change `status` / `v30`
- Modal/row: Inspect opens dialog with GEL contract; Refresh all / per-event buttons exist and are disabled while busy (component tests or DOM tests consistent with `App.test.ts`)

## Out of scope follow-ups

- Raising Snowflake timeout or querying `LAKE_PROD` once sysadmin unblocks App Intel scans
- Per-event contracts beyond GEL
- `?inspect=` deep links
- Refreshing Amplitude API `data.json` from these buttons (that remains `bun run amplitude-refresh-30d`)
