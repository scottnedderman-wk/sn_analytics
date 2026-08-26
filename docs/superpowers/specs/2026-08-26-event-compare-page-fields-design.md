# Event compare — wider modal and GEL page fields

Date: 2026-08-26

Amends `docs/superpowers/specs/2026-08-26-event-compare-inspect-design.md`. Same score rules, cache, HTTP, and non-goals (no exact values, no `experience_name` vs `experienceName`, no session IDs, no Snowflake on page load).

## Goal

Make the Inspect dialog wide enough to read column+type cells, and add the two page attributes that exist on both warehouses for General Experience Loading.

## Modal width

The dialog is **80% of the viewport width** (`width: 80vw`). Drop the current `max-w-3xl` cap. Keep the existing top offset, max height, and vertical scroll.

## GEL comparable-field additions

| Field | App Intel | Amplitude |
|---|---|---|
| Page URL | `url` VARCHAR | `page_url` VARCHAR |
| Host | `host` VARCHAR | `page_domain` VARCHAR |

`FieldKey` gains `"page_url" | "host"`. Both fields are present and type-compatible (VARCHAR↔VARCHAR). Fill SQL uses the existing `COUNT(column)` path; no duration-style special case.

Evidence (Amplitude, `event_date = 2026-08-24`, mapped envs): `page_url`, `page_location`, `page_path`, and `page_domain` were 100% filled. `page_url` equaled `page_location` on every row. App Intel stores `url` and `host`, not `page_*` names.

## Not compared (new)

| Name | Reason |
|---|---|
| `page_location` | Same as Amplitude `page_url` for this event; do not score it twice. |
| `page_path` | Amplitude pathname only. App Intel has no path column; path is implied by `url`. |

Keep the existing omitted notes for `experience_name` vs `experienceName` and `session_id`.

Do **not** add device/OS, referrer, or Amplitude previous-page properties in this change.

## Score and cache

Contract field count becomes **8**. Present and Type remain 100% from the static contract (all eight mapped). Populated and Volume stay pending until refresh. Scores stay computed in process; no SQLite schema change. Cached snapshots with six fields still parse; overlay prefers snapshot fields when present, so a stale cache row can show six fields until the next refresh.

## Tests

`bun test` only. No network.

- Contract has eight fields including `url`/`page_url` and `host`/`page_domain`
- Modal HTML contains those column names and the new omitted names
- Refresh fake-fetch fill row is `COUNT(*)` plus eight field counts

## Out of scope

- Deriving App Intel path via `PARSE_URL(url)`
- Scoring `page_location` as a third page field
- Other events’ contracts
- Changing header `% live` / Live / 30d volume / GitHub
