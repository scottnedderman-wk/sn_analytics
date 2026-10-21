import { seedAiIdentities } from "./homepageVolumes";
import type { DashboardData, MigrationEvent } from "./model";
import { AI_STATEMENT_SESSION, credsFromEnv, executeStatement, type ExecuteDeps } from "./snowflakeEvents";
import type { DayWindow } from "./volumeWindow";

export const SAMPLE_FIELDS = [
  { key: "eventTime", label: "Event time" },
  { key: "user", label: "User" },
  { key: "organization", label: "Organization" },
  { key: "workspace", label: "Workspace" },
  { key: "duration", label: "Duration" },
  { key: "environment", label: "Environment" },
  { key: "pageUrl", label: "Page URL" },
  { key: "host", label: "Host" },
] as const;

export type SampleFieldKey = (typeof SAMPLE_FIELDS)[number]["key"];

export type EventSampleSide = Record<SampleFieldKey, string | null> & {
  properties: Record<string, string>;
};

export type ExampleFieldRow = {
  key: string;
  label: string;
  amp: string | null;
  ai: string | null;
};

export type EventSample = {
  paired: boolean;
  amp: EventSampleSide | null;
  ai: EventSampleSide | null;
};

export type SampleQuery = (sql: string, source: "amp" | "ai") => Promise<string[][]>;

const AMP_TO_AI_ENV: Record<string, string> = {
  us: "production",
  eu: "prod-eu",
  apac: "prod-apac",
};

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function blank(value: string | null | undefined): string | null {
  if (value == null || value === "") return null;
  return value;
}

function propertyText(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") return value === "" ? null : value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

export function parseProperties(value: string | null | undefined): Record<string, string> {
  if (!value || !value.startsWith("{")) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [key, item] of Object.entries(parsed)) {
      const text = propertyText(item);
      if (text != null) out[key] = text;
    }
    return out;
  } catch {
    return {};
  }
}

export function exampleFieldRows(sample: EventSample): ExampleFieldRow[] {
  const rows: ExampleFieldRow[] = SAMPLE_FIELDS.map((field) => ({
    key: field.key,
    label: field.label,
    amp: sample.amp?.[field.key] ?? null,
    ai: sample.ai?.[field.key] ?? null,
  }));
  const extras = new Set([
    ...Object.keys(sample.amp?.properties ?? {}),
    ...Object.keys(sample.ai?.properties ?? {}),
  ]);
  for (const key of [...extras].sort((a, b) => a.localeCompare(b))) {
    rows.push({
      key,
      label: key,
      amp: sample.amp?.properties?.[key] ?? null,
      ai: sample.ai?.properties?.[key] ?? null,
    });
  }
  return rows;
}

export function sampleSideFromRow(row: ReadonlyArray<string | null | undefined> | undefined): EventSampleSide | null {
  if (!row) return null;
  return {
    eventTime: blank(row[0]),
    user: blank(row[1]),
    organization: blank(row[2]),
    workspace: blank(row[3]),
    duration: blank(row[4]),
    environment: blank(row[5]),
    pageUrl: blank(row[6]),
    host: blank(row[7]),
    properties: parseProperties(row[8]),
  };
}

export function aiEnvForAmp(environment: string | null): string | null {
  if (!environment) return null;
  return AMP_TO_AI_ENV[environment] ?? null;
}

export function aiIdentitySql(event: MigrationEvent): string {
  const parts = [
    `category = ${sqlString(event.aiCategory ?? "")}`,
    `action = ${sqlString(event.aiAction ?? "")}`,
  ];
  if (event.aiEvent) parts.push(`dimensions:event::VARCHAR = ${sqlString(event.aiEvent)}`);
  if (event.aiEventExclude?.length) {
    parts.push(`dimensions:event::VARCHAR NOT IN (${event.aiEventExclude.map(sqlString).join(",")})`);
    parts.push(`dimensions:event::VARCHAR NOT LIKE 'progressItem.%'`);
    parts.push(`dimensions:event::VARCHAR NOT LIKE 'notificationItem.%'`);
    parts.push(`dimensions:event::VARCHAR NOT LIKE 'createMenuItem.%'`);
  }
  return parts.join("\n  AND ");
}

function aiDateSql(window: DayWindow, day?: string): string {
  if (day) return `TRY_TO_TIMESTAMP(dimensions:timestamp::VARCHAR)::DATE = ${sqlString(day)}`;
  return `TRY_TO_TIMESTAMP(dimensions:timestamp::VARCHAR)::DATE BETWEEN ${sqlString(window.start)} AND ${sqlString(window.end)}`;
}

const AI_COLUMNS = `TO_VARCHAR(DATE_TRUNC('second', TRY_TO_TIMESTAMP(dimensions:timestamp::VARCHAR)), 'YYYY-MM-DD HH24:MI:SS'),
  dimensions:user_resource_id::VARCHAR,
  dimensions:organization_id::VARCHAR,
  dimensions:account_resource_id::VARCHAR,
  value::VARCHAR,
  environment::VARCHAR,
  dimensions:url::VARCHAR,
  dimensions:host::VARCHAR,
  dimensions::VARCHAR`;

export const SAMPLE_CANDIDATES = 20;

export function ampSampleSql(eventName: string, window: DayWindow, day?: string, limit = 1): string {
  const dateSql = day
    ? `event_date = ${sqlString(day)}`
    : `event_date BETWEEN ${sqlString(window.start)} AND ${sqlString(window.end)}`;
  return `SELECT
  TO_VARCHAR(DATE_TRUNC('second', event_timestamp), 'YYYY-MM-DD HH24:MI:SS'),
  user_resource_id::VARCHAR,
  organization_id::VARCHAR,
  workspace_id::VARCHAR,
  raw_event_properties:value::VARCHAR,
  environment::VARCHAR,
  page_url::VARCHAR,
  page_domain::VARCHAR,
  raw_event_properties::VARCHAR
FROM gold_prod.marts.fct_amplitude_events
WHERE source_event_type = ${sqlString(eventName)}
  AND is_amplitude_generated_event = FALSE
  AND ${dateSql}
  AND environment IN ('us','eu','apac')
LIMIT ${limit}`;
}

export function aiSampleSql(event: MigrationEvent, window: DayWindow, day?: string, limit = 1): string {
  return `SELECT
  ${AI_COLUMNS}
FROM SILVER_PROD.ADMIN.USER_ANALYTIC
WHERE ${aiDateSql(window, day)}
  AND environment IN ('production','prod-eu','prod-apac')
  AND ${aiIdentitySql(event)}
LIMIT ${limit}`;
}

function equalNull(expr: string, value: string | null): string {
  return value == null ? `EQUAL_NULL(${expr}, NULL)` : `EQUAL_NULL(${expr}, ${sqlString(value)})`;
}

export function urlsAlign(ampUrl: string | null, aiUrl: string | null): boolean {
  const amp = (ampUrl ?? "").replace(/\/+$/, "");
  const ai = (aiUrl ?? "").replace(/\/+$/, "");
  if (!amp || !ai) return false;
  return amp === ai || amp.startsWith(`${ai}/`) || ai.startsWith(`${amp}/`);
}

function aiFingerprintPredicate(amp: EventSampleSide): string | null {
  const aiEnv = aiEnvForAmp(amp.environment);
  if (!amp.eventTime || !aiEnv) return null;
  return `(${equalNull("dimensions:user_resource_id::VARCHAR", amp.user)}
    AND ${equalNull("dimensions:organization_id::VARCHAR", amp.organization)}
    AND ${equalNull("dimensions:account_resource_id::VARCHAR", amp.workspace)}
    AND ${equalNull("dimensions:host::VARCHAR", amp.host)}
    AND environment = ${sqlString(aiEnv)}
    AND DATE_TRUNC('second', TRY_TO_TIMESTAMP(dimensions:timestamp::VARCHAR)) = TRY_TO_TIMESTAMP(${sqlString(amp.eventTime)}))`;
}

export function aiMatchSql(event: MigrationEvent, amp: EventSampleSide, day: string): string | null {
  const predicate = aiFingerprintPredicate(amp);
  if (!predicate) return null;
  return `SELECT
  ${AI_COLUMNS}
FROM SILVER_PROD.ADMIN.USER_ANALYTIC
WHERE TRY_TO_TIMESTAMP(dimensions:timestamp::VARCHAR)::DATE = ${sqlString(day)}
  AND ${aiIdentitySql(event)}
  AND ${predicate}
LIMIT 2`;
}

export function aiCandidateSql(event: MigrationEvent, day: string, amps: EventSampleSide[]): string | null {
  const predicates = amps.map(aiFingerprintPredicate).filter((predicate): predicate is string => predicate != null);
  if (!predicates.length) return null;
  return `SELECT
  ${AI_COLUMNS}
FROM SILVER_PROD.ADMIN.USER_ANALYTIC
WHERE TRY_TO_TIMESTAMP(dimensions:timestamp::VARCHAR)::DATE = ${sqlString(day)}
  AND ${aiIdentitySql(event)}
  AND (${predicates.join(" OR ")})`;
}

function ampFingerprintPredicate(amp: EventSampleSide): string | null {
  if (!amp.eventTime || !aiEnvForAmp(amp.environment)) return null;
  return `(${equalNull("user_resource_id::VARCHAR", amp.user)}
    AND ${equalNull("organization_id::VARCHAR", amp.organization)}
    AND ${equalNull("workspace_id::VARCHAR", amp.workspace)}
    AND ${equalNull("page_domain::VARCHAR", amp.host)}
    AND environment = ${sqlString(amp.environment ?? "")}
    AND DATE_TRUNC('second', event_timestamp) = TRY_TO_TIMESTAMP(${sqlString(amp.eventTime)}))`;
}

export function ampCountSql(eventName: string, day: string, amps: EventSampleSide[]): string | null {
  const predicates = amps.map(ampFingerprintPredicate).filter((predicate): predicate is string => predicate != null);
  if (!predicates.length) return null;
  return `SELECT
  TO_VARCHAR(DATE_TRUNC('second', event_timestamp), 'YYYY-MM-DD HH24:MI:SS'),
  user_resource_id::VARCHAR,
  organization_id::VARCHAR,
  workspace_id::VARCHAR,
  ANY_VALUE(raw_event_properties:value::VARCHAR),
  environment::VARCHAR,
  ANY_VALUE(page_url::VARCHAR),
  page_domain::VARCHAR,
  COUNT(*)
FROM gold_prod.marts.fct_amplitude_events
WHERE source_event_type = ${sqlString(eventName)}
  AND is_amplitude_generated_event = FALSE
  AND event_date = ${sqlString(day)}
  AND environment IN ('us','eu','apac')
  AND (${predicates.join(" OR ")})
GROUP BY 1, 2, 3, 4, 6, 8`;
}

function pairKey(side: EventSampleSide, environment: string | null): string | null {
  if (!side.eventTime || !environment) return null;
  return [side.eventTime, side.user ?? "", side.organization ?? "", side.workspace ?? "", side.host ?? "", environment].join("\u0000");
}

function distinctSides(sides: EventSampleSide[]): EventSampleSide[] {
  const seen = new Set<string>();
  const out: EventSampleSide[] = [];
  for (const side of sides) {
    const key = SAMPLE_FIELDS.map((field) => side[field.key] ?? "").join("\u0000");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(side);
  }
  return out;
}

function sampleDays(window: DayWindow, preferred?: string | null): Array<string | undefined> {
  const ordered = [preferred || undefined, window.end, undefined];
  return ordered.filter((day, index) => ordered.indexOf(day) === index);
}

async function firstSample(
  query: SampleQuery,
  source: "amp" | "ai",
  sqlForDay: (day?: string) => string,
  window: DayWindow,
  preferred?: string | null,
): Promise<EventSampleSide | null> {
  for (const day of sampleDays(window, preferred)) {
    const rows = await query(sqlForDay(day), source);
    const side = sampleSideFromRow(rows[0]);
    if (side) return side;
  }
  return null;
}

function sidesFrom(rows: string[][]): EventSampleSide[] {
  return rows.map((row) => sampleSideFromRow(row)).filter((side): side is EventSampleSide => side != null);
}

export async function loadEventSample(
  event: MigrationEvent,
  window: DayWindow,
  query: SampleQuery,
): Promise<EventSample> {
  const ampRows = sidesFrom(await query(ampSampleSql(event.name, window, window.end, SAMPLE_CANDIDATES), "amp"));
  const amp = ampRows[0] ?? (await firstSample(query, "amp", (day) => ampSampleSql(event.name, window, day), window));
  const candidates = ampRows.length ? ampRows : amp ? [amp] : [];
  const hasAi = Boolean(event.aiCategory && event.aiAction);
  if (!hasAi) return { paired: false, amp, ai: null };

  const day = candidates.find((side) => side.eventTime)?.eventTime?.slice(0, 10) ?? window.end;
  const candidateSql = aiCandidateSql(event, day, candidates);
  const aiRows = candidateSql ? sidesFrom(await query(candidateSql, "ai")) : [];
  const aiByKey = new Map<string, EventSampleSide[]>();
  for (const side of aiRows) {
    const key = pairKey(side, side.environment);
    if (!key) continue;
    aiByKey.set(key, [...(aiByKey.get(key) ?? []), side]);
  }
  const unique = candidates.filter((side) => {
    const key = pairKey(side, aiEnvForAmp(side.environment));
    const hits = key ? (aiByKey.get(key) ?? []).filter((ai) => urlsAlign(side.pageUrl, ai.pageUrl)) : [];
    return distinctSides(hits).length === 1;
  });
  const countSql = ampCountSql(event.name, day, unique);
  if (countSql) {
    for (const row of await query(countSql, "amp")) {
      if (Number(row[8]) !== 1) continue;
      const counted = sampleSideFromRow(row);
      const key = counted ? pairKey(counted, aiEnvForAmp(counted.environment)) : null;
      const hits = counted && key ? (aiByKey.get(key) ?? []).filter((ai) => urlsAlign(counted.pageUrl, ai.pageUrl)) : [];
      const matches = distinctSides(hits);
      const candidate = candidates.find((side) => pairKey(side, aiEnvForAmp(side.environment)) === key);
      if (counted && matches.length === 1 && matches[0]) return { paired: true, amp: candidate ?? counted, ai: matches[0] };
    }
  }

  const ai = aiRows[0] ?? (await firstSample(query, "ai", (sampleDay) => aiSampleSql(event, window, sampleDay), window, day));
  return { paired: false, amp, ai };
}

export function findSeedEvent(data: DashboardData, repo: string, eventName: string): MigrationEvent | null {
  const seeded = seedAiIdentities(data);
  return seeded.repos.find((item) => item.repo === repo)?.events.find((item) => item.name === eventName) ?? null;
}

export async function queryEventSample(
  event: MigrationEvent,
  window: DayWindow,
  deps: ExecuteDeps = {},
): Promise<EventSample> {
  const creds = credsFromEnv();
  return loadEventSample(event, window, (sql, source) =>
    executeStatement(sql, creds, {
      ...deps,
      session: source === "ai" ? AI_STATEMENT_SESSION : deps.session,
    }),
  );
}
