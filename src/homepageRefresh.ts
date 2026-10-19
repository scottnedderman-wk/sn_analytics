import { topLiveByVolume, type DashboardData, type MigrationEvent } from "./model";
import {
  aiCountForEvent,
  applyHomepageVolumes,
  homepageDayWindow,
  type AiCell,
} from "./homepageVolumes";
import {
  AI_STATEMENT_SESSION,
  credsFromEnv,
  executeStatement,
  type FetchImpl,
  type SnowflakeCreds,
} from "./snowflakeEvents";

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

function aiFromWhere(window: { start: string; end: string }): string {
  return `FROM SILVER_PROD.ADMIN.USER_ANALYTIC
WHERE TRY_TO_TIMESTAMP(dimensions:timestamp::VARCHAR)::DATE BETWEEN '${window.start}' AND '${window.end}'
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

export function ampHomepageDailySql(window: { start: string; end: string }, names: string[]): string {
  return `SELECT source_event_type, TO_CHAR(event_date, 'YYYY-MM-DD') AS d, COUNT(*) AS event_count
FROM gold_prod.marts.fct_amplitude_events
WHERE is_amplitude_generated_event = FALSE
  AND event_date BETWEEN '${window.start}' AND '${window.end}'
  AND environment IN ('us','eu','apac')
  ${ampNameFilter(names)}
GROUP BY 1, 2
ORDER BY 1, 2`;
}

export function aiHomepageDailySql(
  window: { start: string; end: string },
  identities: HomepageAiIdentity[],
): string {
  const unique = uniqueIdentities(identities);
  const dateExpr = `TO_CHAR(TRY_TO_TIMESTAMP(dimensions:timestamp::VARCHAR)::DATE, 'YYYY-MM-DD') AS d`;
  if (unique.length === 0) {
    return `SELECT category, action, dimensions:event::VARCHAR AS ev,
  ${dateExpr}, COUNT(*) AS event_count
${aiFromWhere(window)}
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
${aiFromWhere(window)}
  AND ${pairIn(dedicated)}
GROUP BY 1, 2, 4`);
  }
  if (named.length) {
    parts.push(`SELECT category, action, dimensions:event::VARCHAR AS ev,
  ${dateExpr}, COUNT(*) AS event_count
${aiFromWhere(window)}
  AND (${namedEventPredicate(named)})
GROUP BY 1, 2, 3, 4`);
  }
  if (remainders.length) {
    parts.push(`SELECT category, action, NULL AS ev,
  ${dateExpr}, COUNT(*) AS event_count
${aiFromWhere(window)}
  AND (${remainders.map(remainderPredicate).join(" OR ")})
GROUP BY 1, 2, 4`);
  }
  return `${parts.join("\nUNION ALL\n")}
ORDER BY 4`;
}

export type HomepageRefreshDeps = {
  readData: () => Promise<DashboardData> | DashboardData;
  writeData: (data: DashboardData) => Promise<void>;
  credsFromEnv?: () => SnowflakeCreds;
  fetchImpl?: FetchImpl;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
};

const dataUrl = new URL("./data.json", import.meta.url);

export async function readDashboardFile(): Promise<DashboardData> {
  return (await Bun.file(dataUrl).json()) as DashboardData;
}

export async function writeDashboardFile(data: DashboardData): Promise<void> {
  await Bun.write(dataUrl, JSON.stringify(data, null, 2) + "\n");
}

function executeDeps(deps: Partial<HomepageRefreshDeps>, ai = false) {
  return {
    fetchImpl: deps.fetchImpl,
    sleep: deps.sleep,
    ...(ai ? { session: AI_STATEMENT_SESSION } : {}),
  };
}

function count(value: string | undefined): number {
  return Number.parseInt(value ?? "0", 10) || 0;
}

function ampTotalsFromRows(rows: string[][]): Map<string, number> {
  return new Map(rows.map((row) => [row[0] ?? "", count(row[1])]));
}

function aiCellsFromRows(rows: string[][]): AiCell[] {
  return rows.map((row) => ({
    category: row[0] ?? "",
    action: row[1] ?? "",
    event: row[2] || null,
    count: count(row[3]),
  }));
}

function eachUtcDate(window: { start: string; end: string }): string[] {
  const dates: string[] = [];
  const cursor = new Date(`${window.start}T00:00:00Z`);
  const end = new Date(`${window.end}T00:00:00Z`);
  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

function emptySeries(names: string[], length: number): Map<string, number[]> {
  return new Map(names.map((name) => [name, Array.from({ length }, () => 0)]));
}

function ampDailyFromRows(
  rows: string[][],
  names: string[],
  dates: string[],
): Map<string, number[]> {
  const series = emptySeries(names, dates.length);
  const indexByDate = new Map(dates.map((date, index) => [date, index]));
  for (const row of rows) {
    const values = series.get(row[0] ?? "");
    const index = indexByDate.get(row[1] ?? "");
    if (values && index != null) values[index] = count(row[2]);
  }
  return series;
}

function aiDailyFromRows(
  rows: string[][],
  events: MigrationEvent[],
  dates: string[],
): Map<string, number[]> {
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
  return new Map(
    events.map((event) => [
      event.name,
      dates.map((date) => aiCountForEvent(event, cellsByDate.get(date) ?? []) ?? 0),
    ]),
  );
}

export async function refreshHomepageData(
  deps: Partial<HomepageRefreshDeps> = {},
): Promise<DashboardData> {
  const readData = deps.readData ?? readDashboardFile;
  const writeData = deps.writeData ?? writeDashboardFile;
  const getCreds = deps.credsFromEnv ?? credsFromEnv;
  const now = (deps.now ?? (() => new Date()))();
  const window = homepageDayWindow(now);
  const refreshedAt = now.toISOString();
  const data = await readData();
  const creds = getCreds();

  const allEvents = data.repos.flatMap((repo) => repo.events);
  const allNames = [...new Set(allEvents.map((event) => event.name))];
  const allIdentities = identitiesFromEvents(allEvents);
  const [ampRows, aiRows] = await Promise.all([
    executeStatement(ampHomepageVolumeSql(window, allNames), creds, executeDeps(deps)),
    executeStatement(aiHomepageVolumeSql(window, allIdentities), creds, executeDeps(deps, true)),
  ]);
  const ampTotals = ampTotalsFromRows(ampRows);
  const aiCells = aiCellsFromRows(aiRows);
  const totals = applyHomepageVolumes(
    data,
    ampTotals,
    aiCells,
    new Map(),
    new Map(),
    window.end,
    refreshedAt,
  );
  const previewEvents = totals.repos.flatMap((repo) => topLiveByVolume(repo.events, 5));
  const previewNames = [...new Set(previewEvents.map((event) => event.name))];
  const previewIdentities = identitiesFromEvents(previewEvents);

  let result = totals;
  if (previewNames.length > 0) {
    const [ampDailyRows, aiDailyRows] = await Promise.all([
      executeStatement(ampHomepageDailySql(window, previewNames), creds, executeDeps(deps)),
      executeStatement(aiHomepageDailySql(window, previewIdentities), creds, executeDeps(deps, true)),
    ]);
    const dates = eachUtcDate(window);
    result = applyHomepageVolumes(
      data,
      ampTotals,
      aiCells,
      ampDailyFromRows(ampDailyRows, previewNames, dates),
      aiDailyFromRows(aiDailyRows, previewEvents, dates),
      window.end,
      refreshedAt,
    );
  }

  await writeData(result);
  return result;
}
