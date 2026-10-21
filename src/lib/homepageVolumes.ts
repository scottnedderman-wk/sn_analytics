import { statusAfterVolume } from "./amplitudeRefresh";
import { contractFor, INGEST_LAG_DAYS, ymdUtc } from "./eventCompare";
import classIdentities from "../data/aiClassIdentities.json" with { type: "json" };
import type { VolumeDailyRow } from "./eventVolumeCache";
import { topLiveByVolume, type DashboardData, type EventStatus, type MigrationEvent } from "./model";
import { eachUtcDate, type DayWindow } from "./volumeWindow";

export const HOMEPAGE_VOLUME_DAYS = 30;

export function windowEndingOn(end: string, days: number): { start: string; end: string } {
  const last = new Date(`${end}T00:00:00Z`);
  const first = new Date(last);
  first.setUTCDate(first.getUTCDate() - (days - 1));
  return { start: ymdUtc(first), end };
}

export function homepageDayWindow(now = new Date()): { start: string; end: string } {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  end.setUTCDate(end.getUTCDate() - INGEST_LAG_DAYS);
  return windowEndingOn(ymdUtc(end), HOMEPAGE_VOLUME_DAYS);
}

export function dashboardVolumeWindow(
  data: Pick<DashboardData, "volumeAsOf" | "volumeWindowDays">,
  now = new Date(),
): { start: string; end: string } {
  if (data.volumeAsOf) {
    return windowEndingOn(data.volumeAsOf, data.volumeWindowDays ?? HOMEPAGE_VOLUME_DAYS);
  }
  return homepageDayWindow(now);
}

export type AiCell = { category: string; action: string; event: string | null; count: number };

export type ClassIdentityCatalog = Record<string, { aiCategory: string; aiAction: string }>;

const KEBAB_EVENT_NAME = /^([A-Za-z][A-Za-z0-9-]*)_(.+)_v\d+$/;
const CLASS_NAME = /\b([A-Za-z][A-Za-z0-9]*EventV\d+)\b/;
const SHELL_GENERIC_CLASS = "ShellGenericAnalyticEventV2";

function isCamelToken(s: string): boolean {
  return /^[a-z][A-Za-z0-9]*$/.test(s);
}

function stripLegacyToken(s: string): string {
  return s.replace(/`/g, "").replace(/\s*\(.*\)\s*$/, "").trim();
}

function kebabIdentity(
  legacy: string[],
): Pick<MigrationEvent, "aiCategory" | "aiAction"> | null {
  for (const raw of legacy) {
    const match = stripLegacyToken(raw).match(KEBAB_EVENT_NAME);
    if (match) return { aiCategory: match[1]!, aiAction: match[2]! };
  }
  return null;
}

function catalogIdentity(
  legacy: string[],
  catalog: ClassIdentityCatalog,
): Pick<MigrationEvent, "aiCategory" | "aiAction"> | null {
  for (const raw of legacy) {
    const match = stripLegacyToken(raw).match(CLASS_NAME);
    if (!match) continue;
    const className = match[1]!;
    if (className === SHELL_GENERIC_CLASS) continue;
    const hit = catalog[className];
    if (hit) return { aiCategory: hit.aiCategory, aiAction: hit.aiAction };
  }
  return null;
}

export function identityFromLegacy(
  legacy: string[],
  catalog: ClassIdentityCatalog = classIdentities,
): Pick<MigrationEvent, "aiCategory" | "aiAction" | "aiEvent"> | null {
  if (legacy.includes(SHELL_GENERIC_CLASS)) {
    const token = legacy.find((l) => l !== SHELL_GENERIC_CLASS && isCamelToken(stripLegacyToken(l)));
    if (token) {
      return {
        aiCategory: "shell",
        aiAction: "generic-analytic",
        aiEvent: stripLegacyToken(token),
      };
    }
  }
  return kebabIdentity(legacy) ?? catalogIdentity(legacy, catalog);
}

export function seedAiIdentities(data: DashboardData): DashboardData {
  return {
    ...data,
    repos: data.repos.map((repo) => ({
      ...repo,
      events: repo.events.map((ev) => {
        const { aiCategory: _c, aiAction: _a, aiEvent: _e, aiEventExclude: _x, ...base } = ev;
        const fromContract = contractFor(ev.name);
        if (fromContract && fromContract.repo === repo.repo) {
          return {
            ...base,
            aiCategory: fromContract.aiCategory,
            aiAction: fromContract.aiAction,
            ...(fromContract.aiEvent ? { aiEvent: fromContract.aiEvent } : {}),
            ...(fromContract.aiEventExclude ? { aiEventExclude: fromContract.aiEventExclude } : {}),
          };
        }
        const fromLegacy = identityFromLegacy(ev.legacy);
        return fromLegacy ? { ...base, ...fromLegacy } : base;
      }),
    })),
  };
}

function likeExcluded(event: string): boolean {
  return (
    event.startsWith("progressItem.") ||
    event.startsWith("notificationItem.") ||
    event.startsWith("createMenuItem.")
  );
}

export function aiCountForEvent(ev: MigrationEvent, cells: AiCell[]): number | null {
  if (!ev.aiCategory || !ev.aiAction) return null;
  const mine = cells.filter((c) => c.category === ev.aiCategory && c.action === ev.aiAction);
  if (ev.aiEvent) {
    return mine.filter((c) => c.event === ev.aiEvent).reduce((s, c) => s + c.count, 0);
  }
  if (ev.aiEventExclude?.length) {
    const named = new Set(ev.aiEventExclude);
    return mine
      .filter((c) => {
        const name = c.event ?? "";
        return !named.has(name) && !likeExcluded(name);
      })
      .reduce((s, c) => s + c.count, 0);
  }
  return mine.reduce((s, c) => s + c.count, 0);
}

export function applyHomepageVolumes(
  data: DashboardData,
  ampTotals: Map<string, number>,
  aiCells: AiCell[],
  ampDaily: Map<string, number[]>,
  aiDaily: Map<string, number[]>,
  asOf: string,
  refreshedAt: string,
): DashboardData {
  const repos = data.repos.map((repo) => {
    if (repo.events.length === 0) return repo;
    const events = repo.events.map((ev) => {
      const v30 = ampTotals.get(ev.name) ?? 0;
      const ai30 = aiCountForEvent(ev, aiCells);
      return { ...ev, v30, ai30, status: statusAfterVolume(ev, v30) };
    });
    const preview = new Set(topLiveByVolume(events, 5).map((e) => e.name));
    const withSeries = events.map((ev) => {
      const next = { ...ev };
      if (preview.has(ev.name)) {
        if (ampDaily.has(ev.name)) next.series30 = ampDaily.get(ev.name);
        if (ev.ai30 != null && aiDaily.has(ev.name)) next.aiSeries30 = aiDaily.get(ev.name);
      } else {
        delete next.series30;
        delete next.aiSeries30;
      }
      return next;
    });
    let volume30 = 0;
    let volume30Ai = 0;
    const counts: DashboardData["repos"][number]["counts"] = {};
    for (const e of withSeries) {
      counts[e.status] = (counts[e.status] || 0) + 1;
      volume30 += e.v30 || 0;
      if (e.ai30 != null) volume30Ai += e.ai30;
    }
    return {
      ...repo,
      events: withSeries,
      counts,
      volume30,
      volume30Ai,
      live: counts.live || 0,
      total: withSeries.length,
    };
  });
  return { ...data, volumeAsOf: asOf, volumeWindowDays: 30, volumeRefreshedAt: refreshedAt, repos };
}

export function applyVolumeDaily(
  data: DashboardData,
  rows: VolumeDailyRow[],
  window: DayWindow,
  refreshedAt: string,
): DashboardData {
  const dates = eachUtcDate(window);
  const byRepo = new Map<string, VolumeDailyRow[]>();
  for (const row of rows) {
    const list = byRepo.get(row.repo) ?? [];
    list.push(row);
    byRepo.set(row.repo, list);
  }
  const repos = data.repos.map((repo) => {
    if (repo.events.length === 0) return repo;
    const mine = byRepo.get(repo.repo) ?? [];
    const events = repo.events.map((ev) => {
      const amp = mine.filter((row) => row.source === "amp" && row.eventName === ev.name);
      const ai = mine.filter((row) => row.source === "ai" && row.eventName === ev.name);
      const v30 = amp.reduce((sum, row) => sum + row.count, 0);
      const ai30 = ev.aiCategory && ev.aiAction ? ai.reduce((sum, row) => sum + row.count, 0) : null;
      return { ...ev, v30, ai30, status: statusAfterVolume(ev, v30) };
    });
    const preview = new Set(topLiveByVolume(events, 5).map((event) => event.name));
    const withSeries = events.map((ev) => {
      const next = { ...ev };
      if (preview.has(ev.name)) {
        const amp = mine.filter((row) => row.source === "amp" && row.eventName === ev.name);
        const ai = mine.filter((row) => row.source === "ai" && row.eventName === ev.name);
        next.series30 = dates.map((day) => amp.find((row) => row.day === day)?.count ?? 0);
        if (ev.ai30 != null) next.aiSeries30 = dates.map((day) => ai.find((row) => row.day === day)?.count ?? 0);
        else delete next.aiSeries30;
      } else {
        delete next.series30;
        delete next.aiSeries30;
      }
      return next;
    });
    let volume30 = 0;
    let volume30Ai = 0;
    const counts: Partial<Record<EventStatus, number>> = {};
    for (const event of withSeries) {
      counts[event.status] = (counts[event.status] || 0) + 1;
      volume30 += event.v30 || 0;
      if (event.ai30 != null) volume30Ai += event.ai30;
    }
    return {
      ...repo,
      events: withSeries,
      counts,
      volume30,
      volume30Ai,
      live: counts.live || 0,
      total: withSeries.length,
    };
  });
  return {
    ...data,
    volumeAsOf: window.end,
    volumeWindowDays: dates.length,
    volumeRefreshedAt: refreshedAt,
    repos,
  };
}
