# GEL App Intel vs Amplitude stream compare

Date: 2026-09-15

How to compare Workiva **App Intel (legacy)** vs **Amplitude (new)** for **General Experience Loading (GEL)** in Snowflake. Do not row-join events. Score streams with daily volume plus field presence/type/fill, within a stated tolerance.

## Identity

Client dual-write in `wdesk_sdk` `attachLoadDurationReporter`: Amplitude `trackEvent('General Experience Loading')`, then App Intel `GeneralExperienceLoadingEventV2`.

- Lake/table filter: `category = 'general'` and `action = 'experience-loading'`
- Amplitude mart: `source_event_type = 'General Experience Loading'` and `is_amplitude_generated_event = FALSE`

## Sources (as of 2026-09-15)

| Stream | Table | Warehouse | Date column |
|---|---|---|---|
| Amplitude | `gold_prod.marts.fct_amplitude_events` | `PROD_WH` | `event_date` (from `event_timestamp`) |
| App Intel | `SILVER_PROD.ADMIN.USER_ANALYTIC` | `PROD_SILVER_LARGE_DBT_WAREHOUSE` | `TRY_TO_TIMESTAMP(dimensions:timestamp::VARCHAR)::DATE` |

Role: `TECH_ANALYST`.

Do **not** use:

- The GEL view `silver_prod.user_analytic.general_experience_loading` (timeouts)
- App Intel top-level `timestamp` (masked)
- App Intel `event_timestamp` (unused 1582 sentinel)

Comparable App Intel payload is the `dimensions` VARIANT OBJECT. Duration is top-level `value`.

Auth: Snowflake PAT from `.env` `SNOWFLAKE_PAT`. Never log the token. Network-policy bypass and PAT expiry cause 401s.

## Fair prod window

Closed 7 UTC days excluding today. Mapped envs only:

| Amplitude | App Intel |
|---|---|
| `us` | `production` |
| `eu` | `prod-eu` |
| `apac` | `prod-apac` |

Drop Amplitude `ca` and null env. Drop App Intel `sandbox` and `demo`.

## Do not join rows

App Intel `guid` ≠ Amplitude `uuid` / `source_event_id`.

Optional side-by-side *samples* may use a unique composite fingerprint (user + org + workspace + URL + duration + mapped env + timestamp truncated to the second) only when that key is 1:1 on both sides in a short window. That is not the volume/field score.

## Volume score

```
round(100 * min(count_ai, count_amp) / max(count_ai, count_amp))
```

Score **only days present and complete on both sides**. Also break out daily counts so one bad day cannot hide in the week total.

App Intel silver lagged in Sep 2026 (max GEL `dimensions:timestamp` 2026-09-10; that day incomplete). On complete overlap 2026-09-08 and 2026-09-09, counts scored ~97 (App Intel ~3% higher). A 7-day score that includes unloaded App Intel days is coverage lag, not a dual-write miss.

## Contracted fields

Score Present / Type / Populated. Types are compatible if both date-like, both string, or both numeric. Populated if **both** sides have ≥50% non-null (`POPULATED_FLOOR = 0.5`). Do not score exact string/number equality except for optional sample pairs.

| Field | App Intel | Amplitude |
|---|---|---|
| Event time | `dimensions:timestamp` VARCHAR ISO | `event_date` DATE / `event_timestamp` TIMESTAMP_NTZ |
| User | `dimensions:user_resource_id` VARCHAR | `user_resource_id` VARCHAR |
| Organization | `dimensions:organization_id` VARCHAR | `organization_id` VARCHAR |
| Workspace | `dimensions:account_resource_id` VARCHAR | `workspace_id` VARCHAR |
| Duration | top-level `value` VARIANT INTEGER | `raw_event_properties:value` INTEGER or DECIMAL (use `TRY_TO_DOUBLE`) |
| Environment | `environment` VARCHAR | `environment` VARCHAR (after map) |
| Page URL | `dimensions:url` VARCHAR | `page_url` VARCHAR |
| Host | `dimensions:host` VARCHAR | `page_domain` VARCHAR |

On 2026-09-08–09 these eight were present, type-compatible, and 100% filled. Duration p50 was 5 ms on both sides (approx percentile). Amplitude `page_url` equals `page_location` for GEL.

## Omit from Match %

Even if 100% filled:

- `experience_name` vs `experienceName` — route segment vs telemetry label (`Experience loaded in (ms)_` + displayName)
- `session_id` — obfuscated App Intel token vs Amplitude epoch milliseconds
- Amplitude `page_location` — duplicate of `page_url` on GEL
- Amplitude `page_path` — no App Intel path column (implied by `url`)

## Envelope shape

App Intel `dimensions` is a fat client object (~38 keys: browser, OS, IP, tab, parent experience, …). Amplitude GEL `raw_event_properties` is thin (page plugin fields + value / experienceName / org / workspace / env / app). Amplitude device/geo live as mart columns, not dual-write GEL fields — leave them out of Match %.

## Inspect UI

App compare still pointed at the GEL view + `PROD_WH`. Refresh for App Intel must use `ADMIN.USER_ANALYTIC`, `dimensions:timestamp`, and the large warehouse.

## Evidence canvases (2026-09-15/16)

- GEL Event Comparison (volume + destinations)
- GEL field types (key inventory)
- GEL event samples (3 unique US/EU/APAC pairs from 2026-09-09 15:00–15:05 UTC)
