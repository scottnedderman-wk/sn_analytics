export type EventStatus = "live" | "stale" | "dev_only" | "blocked" | "missing";

export type MigrationEvent = {
  name: string;
  legacy: string[];
  status: EventStatus;
  v30: number;
  v365: number;
  dev30: number;
  merged: boolean;
  pr: string | null;
  amp_count: number | null;
  ss_error: string;
  queried: number;
  series30?: number[];
};

export type RepoRecord = {
  repo: string;
  events: MigrationEvent[];
  counts: Partial<Record<EventStatus, number>>;
  total: number;
  live: number;
  volume30: number;
  sources: string[];
  prs: unknown[];
  inv_mapped: number;
  inv_unmapped: number;
};

export type DashboardData = {
  provenance: string;
  volumeAsOf?: string;
  volumeWindowDays?: number;
  repos: RepoRecord[];
};

export type AmplitudeCreds = {
  apiKey: string;
  secretKey: string;
};

const AMPLITUDE_HOST = "https://amplitude.com";

export function ymd(d: Date): string {
  return d.toISOString().slice(0, 10).replaceAll("-", "");
}

/** Inclusive UTC window of the last `days` calendar days ending today. */
export function lastNDayRange(days: number, now = new Date()): { start: string; end: string; endIso: string } {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  return { start: ymd(start), end: ymd(end), endIso: end.toISOString().slice(0, 10) };
}

export function statusAfterVolume(
  ev: Pick<MigrationEvent, "status" | "v365" | "dev30">,
  v30: number,
  deleted = false,
): EventStatus {
  if (ev.status === "blocked" || deleted) return "blocked";
  if (v30 > 0) return "live";
  if (ev.v365 > 0 || ev.status === "live" || ev.status === "stale") return "stale";
  if (ev.dev30 > 0 || ev.status === "dev_only") return "dev_only";
  return "missing";
}

export function recountRepo(repo: RepoRecord): RepoRecord {
  if (repo.total === 0 && repo.events.length === 0) return repo;
  const counts: Partial<Record<EventStatus, number>> = {};
  let volume30 = 0;
  for (const e of repo.events) {
    counts[e.status] = (counts[e.status] || 0) + 1;
    volume30 += e.v30 || 0;
  }
  return {
    ...repo,
    counts,
    volume30,
    live: counts.live || 0,
    total: repo.events.length,
  };
}

export function applyVolumes(
  data: DashboardData,
  volumes: Map<string, number>,
  deleted: Set<string>,
  asOf: string,
): DashboardData {
  const repos = data.repos.map((repo) => {
    if (repo.events.length === 0) return repo;
    const events = repo.events.map((ev) => {
      const v30 = volumes.get(ev.name) ?? 0;
      return { ...ev, v30, status: statusAfterVolume(ev, v30, deleted.has(ev.name)) };
    });
    return recountRepo({ ...repo, events });
  });
  return {
    ...data,
    volumeAsOf: asOf,
    volumeWindowDays: 30,
    repos,
  };
}

function basicAuth(creds: AmplitudeCreds): string {
  return `Basic ${btoa(`${creds.apiKey}:${creds.secretKey}`)}`;
}

async function amplitudeGet(path: string, creds: AmplitudeCreds): Promise<any> {
  let waitMs = 2000;
  for (let attempt = 0; attempt < 10; attempt++) {
    const res = await fetch(`${AMPLITUDE_HOST}${path}`, {
      headers: { Authorization: basicAuth(creds) },
    });
    if (res.status === 429) {
      const retryAfter = Number(res.headers.get("Retry-After"));
      const delay = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : waitMs;
      console.warn(`Amplitude 429; waiting ${Math.round(delay / 1000)}s`);
      await Bun.sleep(delay);
      waitMs = Math.min(waitMs * 2, 60000);
      continue;
    }
    if (!res.ok) {
      const body = (await res.text()).slice(0, 400);
      throw new Error(`Amplitude ${res.status} ${path}: ${body}`);
    }
    return res.json();
  }
  throw new Error(`Amplitude rate-limited after retries: ${path}`);
}

type EventListRow = { id: number; value: string; deleted?: boolean };
type TaxonomyRow = { event_type: string; deleted?: boolean | null };

export async function fetchEventIndex(creds: AmplitudeCreds): Promise<{
  byId: Map<string, EventListRow>;
  byName: Set<string>;
  deleted: Set<string>;
}> {
  const [listJson, taxJson] = await Promise.all([
    amplitudeGet("/api/2/events/list", creds),
    amplitudeGet("/api/2/taxonomy/event", creds),
  ]);
  const list = (listJson.data ?? []) as EventListRow[];
  const tax = (taxJson.data ?? []) as TaxonomyRow[];
  const byId = new Map(list.map((e) => [String(e.id), e]));
  const byName = new Set<string>([...list.map((e) => e.value), ...tax.map((e) => e.event_type)]);
  const deleted = new Set<string>();
  for (const e of list) if (e.deleted) deleted.add(e.value);
  for (const e of tax) if (e.deleted) deleted.add(e.event_type);
  return { byId, byName, deleted };
}

export function collapsedTotals(seriesCollapsed: Array<Array<{ value?: number }> | undefined> | undefined): number[] {
  return (seriesCollapsed ?? []).map((row) => row?.[0]?.value || 0);
}

export function previewLiveNames(data: DashboardData, limit = 5): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const r of data.repos) {
    const live = r.events
      .filter((e) => e.status === "live")
      .sort((a, b) => (b.v30 || 0) - (a.v30 || 0) || a.name.localeCompare(b.name));
    for (const e of live.slice(0, limit)) {
      if (!seen.has(e.name)) {
        seen.add(e.name);
        names.push(e.name);
      }
    }
  }
  return names;
}

export function mapDailySeries(
  labels: string[],
  series: number[][] | undefined,
  byId: Map<string, EventListRow>,
): Map<string, number[]> {
  const out = new Map<string, number[]>();
  for (let i = 0; i < labels.length; i++) {
    const name = byId.get(String(labels[i]))?.value;
    const row = series?.[i];
    if (name && row) out.set(name, row.map((n) => n || 0));
  }
  return out;
}

export function attachSeries30(
  data: DashboardData,
  series: Map<string, number[]>,
  names: Iterable<string>,
): DashboardData {
  const want = new Set(names);
  return {
    ...data,
    repos: data.repos.map((repo) => ({
      ...repo,
      events: repo.events.map((ev) => {
        if (!want.has(ev.name)) return ev;
        const row = series.get(ev.name);
        return row ? { ...ev, series30: row } : ev;
      }),
    })),
  };
}

export async function fetchTopEventVolumes(
  creds: AmplitudeCreds,
  start: string,
  end: string,
  byId: Map<string, EventListRow>,
): Promise<Map<string, number>> {
  const e = encodeURIComponent(JSON.stringify({ event_type: "_active" }));
  const json = await amplitudeGet(
    `/api/2/events/segmentation?e=${e}&start=${start}&end=${end}&m=totals&g=event_type&limit=1000`,
    creds,
  );
  const labels: string[] = json.data?.seriesLabels ?? [];
  const totals = collapsedTotals(json.data?.seriesCollapsed);
  const volumes = new Map<string, number>();
  for (let i = 0; i < labels.length; i++) {
    const name = byId.get(String(labels[i]))?.value;
    if (name) volumes.set(name, totals[i] ?? 0);
  }
  return volumes;
}

async function fetchPairTotals(
  creds: AmplitudeCreds,
  start: string,
  end: string,
  a: string,
  b?: string,
): Promise<Array<[string, number]>> {
  const params = new URLSearchParams({
    e: JSON.stringify({ event_type: a }),
    start,
    end,
    m: "totals",
  });
  if (b) params.set("e2", JSON.stringify({ event_type: b }));
  const json = await amplitudeGet(`/api/2/events/segmentation?${params.toString()}`, creds);
  const totals = collapsedTotals(json.data?.seriesCollapsed);
  const out: Array<[string, number]> = [[a, totals[0] ?? 0]];
  if (b) out.push([b, totals[1] ?? 0]);
  return out;
}

export async function fetchNamedEventVolumes(
  creds: AmplitudeCreds,
  start: string,
  end: string,
  names: string[],
  concurrency = 3,
): Promise<Map<string, number>> {
  const volumes = new Map<string, number>();
  const pairs: Array<[string, string?]> = [];
  for (let i = 0; i < names.length; i += 2) {
    pairs.push([names[i]!, names[i + 1]]);
  }
  let cursor = 0;
  async function worker() {
    while (cursor < pairs.length) {
      const i = cursor++;
      const [a, b] = pairs[i]!;
      const rows = await fetchPairTotals(creds, start, end, a, b);
      for (const [name, total] of rows) volumes.set(name, total);
      if ((i + 1) % 20 === 0 || i + 1 === pairs.length) {
        console.log(`  queried ${Math.min((i + 1) * 2, names.length)}/${names.length} remaining events`);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, pairs.length) }, () => worker()));
  return volumes;
}

async function fetchPairDailySeries(
  creds: AmplitudeCreds,
  start: string,
  end: string,
  a: string,
  b?: string,
): Promise<Array<[string, number[]]>> {
  const params = new URLSearchParams({
    e: JSON.stringify({ event_type: a }),
    start,
    end,
    m: "totals",
    i: "1",
  });
  if (b) params.set("e2", JSON.stringify({ event_type: b }));
  const json = await amplitudeGet(`/api/2/events/segmentation?${params.toString()}`, creds);
  const rows = (json.data?.series ?? []) as number[][];
  const out: Array<[string, number[]]> = [[a, (rows[0] ?? []).map((n) => n || 0)]];
  if (b) out.push([b, (rows[1] ?? []).map((n) => n || 0)]);
  return out;
}

export async function fetchDailySeriesForNames(
  creds: AmplitudeCreds,
  start: string,
  end: string,
  names: string[],
  byId: Map<string, EventListRow>,
  byName: Set<string>,
  concurrency = 3,
): Promise<Map<string, number[]>> {
  const e = encodeURIComponent(JSON.stringify({ event_type: "_active" }));
  const json = await amplitudeGet(
    `/api/2/events/segmentation?e=${e}&start=${start}&end=${end}&m=totals&g=event_type&limit=1000&i=1`,
    creds,
  );
  const series = mapDailySeries(json.data?.seriesLabels ?? [], json.data?.series, byId);
  const missing = names.filter((n) => !series.has(n) && byName.has(n));
  if (!missing.length) return series;

  console.log(`Daily series: querying ${missing.length} preview events not in top 1000…`);
  const pairs: Array<[string, string?]> = [];
  for (let i = 0; i < missing.length; i += 2) pairs.push([missing[i]!, missing[i + 1]]);
  let cursor = 0;
  async function worker() {
    while (cursor < pairs.length) {
      const i = cursor++;
      const [a, b] = pairs[i]!;
      const rows = await fetchPairDailySeries(creds, start, end, a, b);
      for (const [name, row] of rows) series.set(name, row);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, pairs.length) }, () => worker()));
  return series;
}

export async function attachPreviewDailySeries(
  data: DashboardData,
  creds: AmplitudeCreds,
  now = new Date(),
): Promise<DashboardData> {
  const range = lastNDayRange(30, now);
  const index = await fetchEventIndex(creds);
  const names = previewLiveNames(data);
  const series = await fetchDailySeriesForNames(creds, range.start, range.end, names, index.byId, index.byName);
  const matched = names.filter((n) => series.has(n)).length;
  console.log(`Daily series matched ${matched}/${names.length} preview events (${range.start}–${range.end})`);
  return attachSeries30(data, series, names);
}

export function mappedEventNames(data: DashboardData): string[] {
  return [...new Set(data.repos.flatMap((r) => r.events.map((e) => e.name)))];
}

export async function refreshProduction30d(data: DashboardData, creds: AmplitudeCreds, now = new Date()): Promise<DashboardData> {
  const range = lastNDayRange(30, now);
  console.log(`Window ${range.start}–${range.end} (UTC)`);

  const index = await fetchEventIndex(creds);
  console.log(`Catalog: ${index.byName.size} event names, ${index.deleted.size} deleted`);

  const volumes = await fetchTopEventVolumes(creds, range.start, range.end, index.byId);
  console.log(`Top-1000 group-by matched ${volumes.size} names`);

  const remaining = mappedEventNames(data).filter((n) => !volumes.has(n) && index.byName.has(n));
  if (remaining.length) {
    console.log(`Querying ${remaining.length} mapped events not in the top 1000…`);
    const extra = await fetchNamedEventVolumes(creds, range.start, range.end, remaining);
    for (const [name, total] of extra) volumes.set(name, total);
  }

  const withVolumes = applyVolumes(data, volumes, index.deleted, range.endIso);
  const preview = previewLiveNames(withVolumes);
  const daily = await fetchDailySeriesForNames(creds, range.start, range.end, preview, index.byId, index.byName);
  console.log(`Daily series matched ${preview.filter((n) => daily.has(n)).length}/${preview.length} preview events`);
  return attachSeries30(withVolumes, daily, preview);
}

export function credsFromEnv(env: { AMPLITUDE_API_KEY?: string; AMPLITUDE_SECRET_KEY?: string } = process.env): AmplitudeCreds {
  const apiKey = env.AMPLITUDE_API_KEY?.trim() ?? "";
  const secretKey = env.AMPLITUDE_SECRET_KEY?.trim() ?? "";
  if (!apiKey || !secretKey) {
    throw new Error("Set AMPLITUDE_API_KEY and AMPLITUDE_SECRET_KEY in .env");
  }
  return { apiKey, secretKey };
}
