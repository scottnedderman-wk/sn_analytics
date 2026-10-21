import type { Database } from "bun:sqlite";
import { seedJsonUrl } from "./dataPath";
import {
  listVolumeDaily,
  markVolumeDaysFetched,
  missingVolumeDays,
  putVolumeDaily,
  type VolumeDailyRow,
} from "./eventVolumeCache";
import {
  aiCountForEvent,
  applyVolumeDaily,
  type AiCell,
} from "./homepageVolumes";
import { type DashboardData, type MigrationEvent } from "./model";
import { hydrateSeed, type SeedData } from "./seed";
import {
  AI_STATEMENT_SESSION,
  credsFromEnv,
  executeStatement,
  type FetchImpl,
  type SnowflakeCreds,
} from "./snowflakeEvents";
import type { DayWindow } from "./volumeWindow";

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function ampNameFilter(names: string[]): string {
  return names.length === 0
    ? "AND FALSE"
    : `AND source_event_type IN (${names.map(sqlString).join(",")})`;
}

export type HomepageAiIdentity = {
  aiCategory: string;
  aiAction: string;
  aiEvent?: string;
  aiEventExclude?: string[];
};

function uniqueIdentities(identities: HomepageAiIdentity[]): HomepageAiIdentity[] {
  return [
    ...new Map(
      identities.map((identity) => [
        `${identity.aiCategory}\0${identity.aiAction}\0${identity.aiEvent ?? ""}\0${(identity.aiEventExclude ?? []).join(",")}`,
        identity,
      ]),
    ).values(),
  ];
}

function pairIn(identities: HomepageAiIdentity[]): string {
  const pairs = [
    ...new Map(
      identities.map((identity) => [
        `${identity.aiCategory}\0${identity.aiAction}`,
        `(${sqlString(identity.aiCategory)},${sqlString(identity.aiAction)})`,
      ]),
    ).values(),
  ];
  return `(category, action) IN (${pairs.join(",")})`;
}

function namedEventPredicate(identities: HomepageAiIdentity[]): string {
  const byPair = new Map<string, { category: string; action: string; events: string[] }>();
  for (const identity of identities) {
    if (!identity.aiEvent) continue;
    const key = `${identity.aiCategory}\0${identity.aiAction}`;
    const group = byPair.get(key) ?? {
      category: identity.aiCategory,
      action: identity.aiAction,
      events: [],
    };
    group.events.push(identity.aiEvent);
    byPair.set(key, group);
  }
  return [...byPair.values()]
    .map(
      (group) =>
        `(${pairIn([{ aiCategory: group.category, aiAction: group.action }])} AND dimensions:event::VARCHAR IN (${group.events.map(sqlString).join(",")}))`,
    )
    .join(" OR ");
}

function remainderPredicate(identity: HomepageAiIdentity): string {
  return `(${pairIn([identity])} AND dimensions:event::VARCHAR NOT IN (${(identity.aiEventExclude ?? []).map(sqlString).join(",")})
  AND dimensions:event::VARCHAR NOT LIKE 'progressItem.%'
  AND dimensions:event::VARCHAR NOT LIKE 'notificationItem.%'
  AND dimensions:event::VARCHAR NOT LIKE 'createMenuItem.%')`;
}

function sqlDateList(days: string[]): string {
  return days.map(sqlString).join(",");
}

function ampDatePredicate(window: { start: string; end: string }, days?: string[]): string {
  if (days) {
    return days.length === 0 ? "AND FALSE" : `AND event_date IN (${sqlDateList(days)})`;
  }
  return `AND event_date BETWEEN '${window.start}' AND '${window.end}'`;
}

function aiFromWhere(window: { start: string; end: string }, days?: string[]): string {
  const datePred = days
    ? days.length === 0
      ? "FALSE"
      : `TRY_TO_TIMESTAMP(dimensions:timestamp::VARCHAR)::DATE IN (${sqlDateList(days)})`
    : `TRY_TO_TIMESTAMP(dimensions:timestamp::VARCHAR)::DATE BETWEEN '${window.start}' AND '${window.end}'`;
  return `FROM SILVER_PROD.ADMIN.USER_ANALYTIC
WHERE ${datePred}
  AND environment IN ('production','prod-eu','prod-apac')`;
}

function identitiesFromEvents(events: MigrationEvent[]): HomepageAiIdentity[] {
  return events.flatMap((event): HomepageAiIdentity[] =>
    event.aiCategory && event.aiAction
      ? [
          {
            aiCategory: event.aiCategory,
            aiAction: event.aiAction,
            ...(event.aiEvent ? { aiEvent: event.aiEvent } : {}),
            ...(event.aiEventExclude ? { aiEventExclude: event.aiEventExclude } : {}),
          },
        ]
      : [],
  );
}

export function ampHomepageVolumeSql(window: { start: string; end: string }, names: string[]): string {
  return `SELECT source_event_type, COUNT(*) AS event_count
FROM gold_prod.marts.fct_amplitude_events
WHERE is_amplitude_generated_event = FALSE
  AND event_date BETWEEN '${window.start}' AND '${window.end}'
  AND environment IN ('us','eu','apac')
  ${ampNameFilter(names)}
GROUP BY 1`;
}

export function aiHomepageVolumeSql(
  window: { start: string; end: string },
  identities: HomepageAiIdentity[],
): string {
  const unique = uniqueIdentities(identities);
  if (unique.length === 0) {
    return `SELECT category, action, dimensions:event::VARCHAR AS ev, COUNT(*) AS event_count
${aiFromWhere(window)}
  AND FALSE
GROUP BY 1, 2, 3`;
  }
  const dedicated = unique.filter((identity) => !identity.aiEvent && !identity.aiEventExclude?.length);
  const named = unique.filter((identity) => identity.aiEvent);
  const remainders = unique.filter((identity) => identity.aiEventExclude?.length);
  const parts: string[] = [];
  if (dedicated.length) {
    parts.push(`SELECT category, action, NULL AS ev, COUNT(*) AS event_count
${aiFromWhere(window)}
  AND ${pairIn(dedicated)}
GROUP BY 1, 2`);
  }
  if (named.length) {
    parts.push(`SELECT category, action, dimensions:event::VARCHAR AS ev, COUNT(*) AS event_count
${aiFromWhere(window)}
  AND (${namedEventPredicate(named)})
GROUP BY 1, 2, 3`);
  }
  if (remainders.length) {
    parts.push(`SELECT category, action, NULL AS ev, COUNT(*) AS event_count
${aiFromWhere(window)}
  AND (${remainders.map(remainderPredicate).join(" OR ")})
GROUP BY 1, 2`);
  }
  return parts.join("\nUNION ALL\n");
}

export function ampHomepageDailySql(
  window: { start: string; end: string },
  names: string[],
  days?: string[],
): string {
  return `SELECT source_event_type, TO_CHAR(event_date, 'YYYY-MM-DD') AS d, COUNT(*) AS event_count
FROM gold_prod.marts.fct_amplitude_events
WHERE is_amplitude_generated_event = FALSE
  ${ampDatePredicate(window, days)}
  AND environment IN ('us','eu','apac')
  ${ampNameFilter(names)}
GROUP BY 1, 2
ORDER BY 1, 2`;
}

export function aiHomepageDailySql(
  window: { start: string; end: string },
  identities: HomepageAiIdentity[],
  days?: string[],
): string {
  const unique = uniqueIdentities(identities);
  const dateExpr = `TO_CHAR(TRY_TO_TIMESTAMP(dimensions:timestamp::VARCHAR)::DATE, 'YYYY-MM-DD') AS d`;
  const fromWhere = aiFromWhere(window, days);
  if (unique.length === 0) {
    return `SELECT category, action, dimensions:event::VARCHAR AS ev,
  ${dateExpr}, COUNT(*) AS event_count
${fromWhere}
  AND FALSE
GROUP BY 1, 2, 3, 4
ORDER BY 4`;
  }
  const dedicated = unique.filter((identity) => !identity.aiEvent && !identity.aiEventExclude?.length);
  const named = unique.filter((identity) => identity.aiEvent);
  const remainders = unique.filter((identity) => identity.aiEventExclude?.length);
  const parts: string[] = [];
  if (dedicated.length) {
    parts.push(`SELECT category, action, NULL AS ev,
  ${dateExpr}, COUNT(*) AS event_count
${fromWhere}
  AND ${pairIn(dedicated)}
GROUP BY 1, 2, 4`);
  }
  if (named.length) {
    parts.push(`SELECT category, action, dimensions:event::VARCHAR AS ev,
  ${dateExpr}, COUNT(*) AS event_count
${fromWhere}
  AND (${namedEventPredicate(named)})
GROUP BY 1, 2, 3, 4`);
  }
  if (remainders.length) {
    parts.push(`SELECT category, action, NULL AS ev,
  ${dateExpr}, COUNT(*) AS event_count
${fromWhere}
  AND (${remainders.map(remainderPredicate).join(" OR ")})
GROUP BY 1, 2, 4`);
  }
  return `${parts.join("\nUNION ALL\n")}
ORDER BY 4`;
}

/** Mapped names or identities per Snowflake statement. Smaller batches report progress and return sooner. */
export const HOMEPAGE_REFRESH_CHUNK = 100;

export type RefreshProgress = {
  completed: number;
  total: number;
  message: string;
};

export type HomepageRefreshDeps = {
  db: Database;
  window: DayWindow;
  readData?: () => Promise<DashboardData> | DashboardData;
  credsFromEnv?: () => SnowflakeCreds;
  fetchImpl?: FetchImpl;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
  chunkSize?: number;
  onProgress?: (progress: RefreshProgress) => void;
};

function chunkItems<T>(items: T[], size: number): T[][] {
  const step = Math.max(1, size);
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += step) out.push(items.slice(index, index + step));
  return out;
}

function rangeLabel(offset: number, count: number, total: number): string {
  const from = offset + 1;
  const to = offset + count;
  return `${from.toLocaleString("en-US")}–${to.toLocaleString("en-US")} of ${total.toLocaleString("en-US")}`;
}

export async function readDashboardFile(): Promise<DashboardData> {
  const seed = (await Bun.file(seedJsonUrl).json()) as SeedData;
  return hydrateSeed(seed);
}

function executeDeps(deps: HomepageRefreshDeps, ai = false) {
  return {
    fetchImpl: deps.fetchImpl,
    sleep: deps.sleep,
    ...(ai ? { session: AI_STATEMENT_SESSION } : {}),
  };
}

function count(value: string | undefined): number {
  return Number.parseInt(value ?? "0", 10) || 0;
}

function reposByEventName(data: DashboardData): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const repo of data.repos) {
    for (const event of repo.events) {
      const list = map.get(event.name) ?? [];
      list.push(repo.repo);
      map.set(event.name, list);
    }
  }
  return map;
}

function ampRowsToDaily(data: DashboardData, rows: string[][], fetchedAt: string): VolumeDailyRow[] {
  const repos = reposByEventName(data);
  const out: VolumeDailyRow[] = [];
  for (const row of rows) {
    const eventName = row[0] ?? "";
    const day = row[1] ?? "";
    const n = count(row[2]);
    if (!eventName || !day || !n) continue;
    for (const repo of repos.get(eventName) ?? []) {
      out.push({ source: "amp", repo, eventName, day, count: n, fetchedAt });
    }
  }
  return out;
}

function aiRowsToDaily(
  data: DashboardData,
  rows: string[][],
  days: string[],
  fetchedAt: string,
): VolumeDailyRow[] {
  const cellsByDate = new Map<string, AiCell[]>();
  for (const row of rows) {
    const date = row[3] ?? "";
    const cells = cellsByDate.get(date) ?? [];
    cells.push({
      category: row[0] ?? "",
      action: row[1] ?? "",
      event: row[2] || null,
      count: count(row[4]),
    });
    cellsByDate.set(date, cells);
  }
  const out: VolumeDailyRow[] = [];
  for (const day of days) {
    const cells = cellsByDate.get(day) ?? [];
    for (const repo of data.repos) {
      for (const event of repo.events) {
        const n = aiCountForEvent(event, cells);
        if (n == null || n === 0) continue;
        out.push({ source: "ai", repo: repo.repo, eventName: event.name, day, count: n, fetchedAt });
      }
    }
  }
  return out;
}

export async function refreshHomepageData(deps: HomepageRefreshDeps): Promise<DashboardData> {
  const readData = deps.readData ?? readDashboardFile;
  const now = (deps.now ?? (() => new Date()))();
  const refreshedAt = now.toISOString();
  const data = await readData();
  const missingAmp = missingVolumeDays(deps.db, "amp", deps.window);
  const missingAi = missingVolumeDays(deps.db, "ai", deps.window);

  if (missingAmp.length || missingAi.length) {
    const allEvents = data.repos.flatMap((repo) => repo.events);
    const allNames = [...new Set(allEvents.map((event) => event.name))];
    const allIdentities = uniqueIdentities(identitiesFromEvents(allEvents));
    const chunkSize = deps.chunkSize ?? HOMEPAGE_REFRESH_CHUNK;
    let creds: SnowflakeCreds | null = null;
    const snowflakeCreds = () => {
      creds ??= (deps.credsFromEnv ?? credsFromEnv)();
      return creds;
    };
    const steps: Array<{ message: string; run: () => Promise<void> }> = [];
    if (missingAmp.length) {
      const batches = chunkItems(allNames, chunkSize);
      if (batches.length === 0) {
        steps.push({
          message: "Amplitude · no mapped events",
          run: async () => markVolumeDaysFetched(deps.db, "amp", missingAmp, refreshedAt),
        });
      } else {
        batches.forEach((names, index) => {
          const message = `Amplitude · events ${rangeLabel(index * chunkSize, names.length, allNames.length)} · ${missingAmp.length} day${missingAmp.length === 1 ? "" : "s"}`;
          steps.push({
            message,
            run: async () => {
              const rows = await executeStatement(
                ampHomepageDailySql(deps.window, names, missingAmp),
                snowflakeCreds(),
                executeDeps(deps),
              );
              putVolumeDaily(deps.db, ampRowsToDaily(data, rows, refreshedAt));
              if (index === batches.length - 1) markVolumeDaysFetched(deps.db, "amp", missingAmp, refreshedAt);
            },
          });
        });
      }
    }
    if (missingAi.length) {
      const batches = chunkItems(allIdentities, chunkSize);
      if (batches.length === 0) {
        steps.push({
          message: "App Intel · no mapped identities",
          run: async () => markVolumeDaysFetched(deps.db, "ai", missingAi, refreshedAt),
        });
      } else {
        batches.forEach((identities, index) => {
          const message = `App Intel · identities ${rangeLabel(index * chunkSize, identities.length, allIdentities.length)} · ${missingAi.length} day${missingAi.length === 1 ? "" : "s"}`;
          steps.push({
            message,
            run: async () => {
              const rows = await executeStatement(
                aiHomepageDailySql(deps.window, identities, missingAi),
                snowflakeCreds(),
                executeDeps(deps, true),
              );
              putVolumeDaily(deps.db, aiRowsToDaily(data, rows, missingAi, refreshedAt));
              if (index === batches.length - 1) markVolumeDaysFetched(deps.db, "ai", missingAi, refreshedAt);
            },
          });
        });
      }
    }
    for (let index = 0; index < steps.length; index++) {
      const step = steps[index]!;
      deps.onProgress?.({ completed: index, total: steps.length, message: step.message });
      await step.run();
      deps.onProgress?.({ completed: index + 1, total: steps.length, message: step.message });
    }
  }

  return applyVolumeDaily(data, listVolumeDaily(deps.db, deps.window), deps.window, refreshedAt);
}
