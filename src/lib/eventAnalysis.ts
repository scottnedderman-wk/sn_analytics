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

export type AnalysisColumn = { label: string; align: "left" | "right" };

export type AnalysisSection = {
  title: string;
  paragraphs: string[];
  table?: {
    columns: AnalysisColumn[];
    rows: Array<{ cells: string[] }>;
  };
};

export type EventAnalysis = {
  day: string;
  regions: RegionCount[];
  ampSampled: number;
  ampMatched: number;
  aiSampled: number;
  aiMatched: number;
  sentence: string;
  sections: AnalysisSection[];
  durationMs?: number;
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

export function ampTriggerSql(eventName: string, day: string): string {
  return `SELECT environment::VARCHAR, COALESCE(raw_event_properties:initiated_from::VARCHAR, '(none)'), COUNT(*)
FROM gold_prod.marts.fct_amplitude_events
WHERE source_event_type = ${sqlString(eventName)}
  AND is_amplitude_generated_event = FALSE
  AND event_date = ${sqlString(day)}
  AND environment IN ('us','eu','apac')
GROUP BY 1, 2`;
}

export function aiTriggerSql(event: MigrationEvent, day: string): string {
  return `SELECT environment::VARCHAR, COALESCE(dimensions:trigger::VARCHAR, '(none)'), COUNT(*)
FROM SILVER_PROD.ADMIN.USER_ANALYTIC
WHERE TRY_TO_TIMESTAMP(dimensions:timestamp::VARCHAR)::DATE = ${sqlString(day)}
  AND environment IN ('production','prod-eu','prod-apac')
  AND ${aiIdentitySql(event)}
GROUP BY 1, 2`;
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

export function analysisSentence(analysis: {
  day: string;
  regions: RegionCount[];
  ampSampled: number;
  ampMatched: number;
  aiSampled: number;
  aiMatched: number;
}): string {
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

type SplitCount = { environment: string; value: string; count: number };

const AMP_ENVS = ["us", "eu", "apac"] as const;

function countText(n: number): string {
  return n.toLocaleString("en-US");
}

function diffText(amp: number, ai: number): string {
  const diff = diffPct(amp, ai);
  return diff == null ? "—" : `${diff}%`;
}

function splitsOf(rows: string[][]): SplitCount[] {
  return rows
    .map((row) => ({
      environment: row[0] ?? "",
      value: row[1] ?? "(none)",
      count: Number.parseFloat(row[2] ?? "0") || 0,
    }))
    .filter((row) => row.environment && row.count > 0);
}

function splitCount(rows: SplitCount[], environment: string, value: string): number {
  return rows.filter((row) => row.environment === environment && row.value === value).reduce((sum, row) => sum + row.count, 0);
}

function aiEnvironment(ampEnv: string): string {
  return Object.entries(AI_TO_AMP).find(([, value]) => value === ampEnv)?.[0] ?? "";
}

export function triggerSection(ampRows: SplitCount[], aiRows: SplitCount[]): AnalysisSection | null {
  const values = [...new Set([...ampRows, ...aiRows].map((row) => row.value))].filter((value) => value && value !== "(none)");
  if (!values.length) return null;
  const compared = values.flatMap((value) =>
    AMP_ENVS.map((env) => {
      const amp = splitCount(ampRows, env, value);
      const ai = splitCount(aiRows, aiEnvironment(env), value);
      return { value, env, amp, ai, gap: Math.abs(amp - ai) };
    }).filter((row) => row.amp > 0 || row.ai > 0),
  );
  if (!compared.length) return null;

  const byValue = new Map<string, { amp: number; ai: number; gap: number }>();
  for (const row of compared) {
    const current = byValue.get(row.value) ?? { amp: 0, ai: 0, gap: 0 };
    current.amp += row.amp;
    current.ai += row.ai;
    current.gap += row.gap;
    byValue.set(row.value, current);
  }
  const ranked = [...byValue.entries()].sort((a, b) => b[1].gap - a[1].gap);
  const top = ranked[0];
  const totalGap = ranked.reduce((sum, [, item]) => sum + item.gap, 0);
  const paragraphs = [
    "Splitting both sides by how the event was triggered shows where the volumes diverge. Amplitude records this as initiated_from and App Intel records it as trigger.",
  ];
  if (top && totalGap > 0) {
    const [value, item] = top;
    const regions = compared
      .filter((row) => row.value === value && row.gap > 0)
      .sort((a, b) => b.gap - a.gap)
      .map((row) => `${row.env} has ${countText(row.amp)} Amplitude and ${countText(row.ai)} App Intel`);
    const lead =
      item.gap * 2 >= totalGap
        ? `${value} accounts for most of the difference`
        : `The largest difference is ${value} (${countText(item.amp)} Amplitude, ${countText(item.ai)} App Intel)`;
    paragraphs.push(regions.length ? `${lead}. ${regions.join(". ")}.` : `${lead}.`);
    const worst = compared.filter((row) => row.value === value).sort((a, b) => b.gap - a.gap)[0];
    if (worst && worst.amp > 0 && worst.ai >= worst.amp * 2) {
      paragraphs.push(
        `In ${worst.env}, App Intel records about ${Math.round(worst.ai / worst.amp)}× as many ${value} events as Amplitude (${countText(worst.amp)} vs ${countText(worst.ai)}).`,
      );
    }
  }
  const closer = ranked.slice(1);
  if (closer.length) {
    paragraphs.push(
      `Other triggers stay closer. ${closer
        .map(([value, item]) => `${value} is ${countText(item.amp)} Amplitude and ${countText(item.ai)} App Intel`)
        .join(". ")}.`,
    );
  }
  return {
    title: "Trigger",
    paragraphs,
    table: {
      columns: [
        { label: "Trigger", align: "left" },
        { label: "Region", align: "left" },
        { label: "Amplitude", align: "right" },
        { label: "App Intel", align: "right" },
        { label: "Diff", align: "right" },
      ],
      rows: [...compared]
        .sort((a, b) => b.gap - a.gap || a.value.localeCompare(b.value))
        .map((row) => ({ cells: [row.value, row.env, countText(row.amp), countText(row.ai), diffText(row.amp, row.ai)] })),
    },
  };
}

function regionSection(day: string, regions: RegionCount[]): AnalysisSection {
  const gaps = regions.map((region) => ({ ...region, gap: Math.abs(region.amp - region.ai) }));
  const total = gaps.reduce((sum, region) => sum + region.gap, 0);
  const top = gaps.reduce<(typeof gaps)[number] | null>((best, region) => (!best || region.gap > best.gap ? region : best), null);
  const paragraph =
    top && total > 0 && top.gap * 2 >= total
      ? `On ${day}, ${top.ampEnv} accounts for most of the gap (${countText(top.amp)} Amplitude, ${countText(top.ai)} App Intel${top.diff == null ? "" : `, ${top.diff}%`}).`
      : `On ${day}, the gap is spread across regions.`;
  return {
    title: "Regions",
    paragraphs: [paragraph],
    table: {
      columns: [
        { label: "Region", align: "left" },
        { label: "Amplitude", align: "right" },
        { label: "App Intel", align: "right" },
        { label: "Diff", align: "right" },
      ],
      rows: regions.map((region) => ({
        cells: [`${region.ampEnv} / ${region.aiEnv}`, countText(region.amp), countText(region.ai), region.diff == null ? "—" : `${region.diff}%`],
      })),
    },
  };
}

function exampleSection(analysis: { ampSampled: number; ampMatched: number; aiSampled: number; aiMatched: number }): AnalysisSection | null {
  const paragraphs: string[] = [];
  if (analysis.ampSampled > 0) {
    paragraphs.push(`${analysis.ampMatched} of ${analysis.ampSampled} Amplitude examples match an App Intel event.`);
  }
  if (analysis.aiSampled > 0) {
    paragraphs.push(`${analysis.aiMatched} of ${analysis.aiSampled} App Intel examples match an Amplitude event.`);
  }
  return paragraphs.length ? { title: "Examples", paragraphs } : null;
}

export function analysisDay(event: MigrationEvent, window: DayWindow, rows: Array<{ source: "amp" | "ai"; day: string; count: number }>): string {
  const series = eventVolumeSeries(window, rows, Boolean(event.aiCategory && event.aiAction));
  return dominantGapDay(series) ?? window.end;
}

export async function loadEventAnalysis(event: MigrationEvent, day: string, query: SampleQuery): Promise<EventAnalysis> {
  const window = { start: day, end: day };
  const [ampRegions, aiRegions, ampTriggers, aiTriggers] = await Promise.all([
    query(ampRegionSql(event.name, day), "amp"),
    query(aiRegionSql(event, day), "ai"),
    query(ampTriggerSql(event.name, day), "amp"),
    query(aiTriggerSql(event, day), "ai"),
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
  const sections = [regionSection(day, regions), triggerSection(splitsOf(ampTriggers), splitsOf(aiTriggers)), exampleSection(draft)].filter(
    (section): section is AnalysisSection => section != null,
  );
  return { ...draft, sentence: analysisSentence(draft), sections };
}
