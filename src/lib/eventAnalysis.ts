import { eventVolumeSeries } from "./eventVolumeCache";
import {
  SAMPLE_CANDIDATES,
  aiCandidateSql,
  aiEnvForAmp,
  aiIdentitySql,
  aiSampleSql,
  ampSampleSql,
  sampleSideFromRow,
  urlsAlign,
  type EventSampleSide,
  type SampleQuery,
} from "./eventSample";
import type { MigrationEvent } from "./model";
import type { DayWindow } from "./volumeWindow";
import { dominantGapDay } from "./volumeExplain";

export type RegionCount = {
  ampEnv: string;
  aiEnv: string;
  amp: number;
  ai: number;
  diff: number | null;
};

export type EventAnalysis = {
  day: string;
  regions: RegionCount[];
  ampSampled: number;
  ampMatched: number;
  aiSampled: number;
  aiMatched: number;
  sentence: string;
};

const REGIONS = [
  { ampEnv: "us", aiEnv: "production" },
  { ampEnv: "eu", aiEnv: "prod-eu" },
  { ampEnv: "apac", aiEnv: "prod-apac" },
] as const;

const AI_TO_AMP: Record<string, string> = {
  production: "us",
  "prod-eu": "eu",
  "prod-apac": "apac",
};

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function equalNull(expr: string, value: string | null): string {
  return value == null ? `EQUAL_NULL(${expr}, NULL)` : `EQUAL_NULL(${expr}, ${sqlString(value)})`;
}

function diffPct(amp: number, ai: number): number | null {
  if (amp === 0) return null;
  return Math.round((100 * (amp - ai)) / amp);
}

export function ampRegionSql(eventName: string, day: string): string {
  return `SELECT environment::VARCHAR, COUNT(*)
FROM gold_prod.marts.fct_amplitude_events
WHERE source_event_type = ${sqlString(eventName)}
  AND is_amplitude_generated_event = FALSE
  AND event_date = ${sqlString(day)}
  AND environment IN ('us','eu','apac')
GROUP BY 1`;
}

export function aiRegionSql(event: MigrationEvent, day: string): string {
  return `SELECT environment::VARCHAR, COUNT(*)
FROM SILVER_PROD.ADMIN.USER_ANALYTIC
WHERE TRY_TO_TIMESTAMP(dimensions:timestamp::VARCHAR)::DATE = ${sqlString(day)}
  AND environment IN ('production','prod-eu','prod-apac')
  AND ${aiIdentitySql(event)}
GROUP BY 1`;
}

export function ampMatchSql(eventName: string, day: string, rows: EventSampleSide[]): string | null {
  const predicates = rows
    .map((row) => {
      const environment = row.environment ? AI_TO_AMP[row.environment] : null;
      if (!row.eventTime || !environment) return null;
      return `(${equalNull("user_resource_id::VARCHAR", row.user)}
    AND ${equalNull("organization_id::VARCHAR", row.organization)}
    AND ${equalNull("workspace_id::VARCHAR", row.workspace)}
    AND ${equalNull("page_domain::VARCHAR", row.host)}
    AND environment = ${sqlString(environment)}
    AND DATE_TRUNC('second', event_timestamp) = TRY_TO_TIMESTAMP(${sqlString(row.eventTime)}))`;
    })
    .filter((predicate): predicate is string => predicate != null);
  if (!predicates.length) return null;
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
  AND event_date = ${sqlString(day)}
  AND (${predicates.join(" OR ")})`;
}

function countsOf(rows: string[][]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = row[0] ?? "";
    if (!key) continue;
    counts.set(key, Number.parseFloat(row[1] ?? "0") || 0);
  }
  return counts;
}

function sameText(left: string | null, right: string | null): boolean {
  return (left ?? "") === (right ?? "");
}

export function isSameOccurrence(amp: EventSampleSide, ai: EventSampleSide): boolean {
  return (
    sameText(amp.eventTime, ai.eventTime) &&
    sameText(amp.user, ai.user) &&
    sameText(amp.organization, ai.organization) &&
    sameText(amp.workspace, ai.workspace) &&
    sameText(amp.host, ai.host) &&
    aiEnvForAmp(amp.environment) === ai.environment &&
    urlsAlign(amp.pageUrl, ai.pageUrl)
  );
}

export function countMatched(samples: EventSampleSide[], hits: EventSampleSide[], samplesAreAmp: boolean): number {
  return samples.filter((sample) =>
    hits.some((hit) => (samplesAreAmp ? isSameOccurrence(sample, hit) : isSameOccurrence(hit, sample))),
  ).length;
}

function sides(rows: string[][]): EventSampleSide[] {
  return rows.map((row) => sampleSideFromRow(row)).filter((side): side is EventSampleSide => side != null);
}

export function analysisSentence(analysis: Omit<EventAnalysis, "sentence">): string {
  const gaps = analysis.regions.map((region) => ({ ...region, gap: Math.abs(region.amp - region.ai) }));
  const total = gaps.reduce((sum, region) => sum + region.gap, 0);
  const top = gaps.reduce<(typeof gaps)[number] | null>((best, region) => (!best || region.gap > best.gap ? region : best), null);
  const parts: string[] = [];
  if (top && total > 0 && top.gap * 2 >= total) {
    const diff = diffPct(top.amp, top.ai);
    parts.push(
      `On ${analysis.day}, ${top.ampEnv} accounts for most of the gap (${top.amp.toLocaleString("en-US")} Amplitude, ${top.ai.toLocaleString("en-US")} App Intel${diff == null ? "" : `, ${diff}%`}).`,
    );
  } else {
    parts.push(`On ${analysis.day}, the gap is spread across regions.`);
  }
  if (analysis.ampSampled > 0) {
    parts.push(`${analysis.ampMatched} of ${analysis.ampSampled} Amplitude examples match an App Intel event.`);
  }
  if (analysis.aiSampled > 0) {
    parts.push(`${analysis.aiMatched} of ${analysis.aiSampled} App Intel examples match an Amplitude event.`);
  }
  return parts.join(" ");
}

export function analysisDay(event: MigrationEvent, window: DayWindow, rows: Array<{ source: "amp" | "ai"; day: string; count: number }>): string {
  const series = eventVolumeSeries(window, rows, Boolean(event.aiCategory && event.aiAction));
  return dominantGapDay(series) ?? window.end;
}

export async function loadEventAnalysis(event: MigrationEvent, day: string, query: SampleQuery): Promise<EventAnalysis> {
  const window = { start: day, end: day };
  const [ampRegions, aiRegions] = await Promise.all([
    query(ampRegionSql(event.name, day), "amp"),
    query(aiRegionSql(event, day), "ai"),
  ]);
  const ampCounts = countsOf(ampRegions);
  const aiCounts = countsOf(aiRegions);
  const regions = REGIONS.map((region) => {
    const amp = ampCounts.get(region.ampEnv) ?? 0;
    const ai = aiCounts.get(region.aiEnv) ?? 0;
    return { ...region, amp, ai, diff: diffPct(amp, ai) };
  });

  const ampSamples = sides(await query(ampSampleSql(event.name, window, day, SAMPLE_CANDIDATES), "amp"));
  const aiHitSql = aiCandidateSql(event, day, ampSamples);
  const aiHits = aiHitSql ? sides(await query(aiHitSql, "ai")) : [];
  const aiSamples = sides(await query(aiSampleSql(event, window, day, SAMPLE_CANDIDATES), "ai"));
  const ampHitSql = ampMatchSql(event.name, day, aiSamples);
  const ampHits = ampHitSql ? sides(await query(ampHitSql, "amp")) : [];
  const draft = {
    day,
    regions,
    ampSampled: ampSamples.length,
    ampMatched: countMatched(ampSamples, aiHits, true),
    aiSampled: aiSamples.length,
    aiMatched: countMatched(aiSamples, ampHits, false),
  };
  return { ...draft, sentence: analysisSentence(draft) };
}
