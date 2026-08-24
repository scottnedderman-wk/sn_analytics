export type SnowflakeCreds = { pat: string };

export function credsFromEnv(env: { SNOWFLAKE_PAT?: string } = process.env): SnowflakeCreds {
  const pat = env.SNOWFLAKE_PAT?.trim() ?? "";
  if (!pat) throw new Error("Set SNOWFLAKE_PAT in .env");
  return { pat };
}

export function parseArgs(argv: string[]): { app: string } {
  const positional = argv.slice(2);
  const app = positional[0]?.trim() ?? "";
  if (positional.length !== 1 || !app) {
    throw new Error("Usage: bun run snowflake-events -- <app>");
  }
  return { app };
}

export const SNOWFLAKE_ACCOUNT_URL = "https://lec27990.us-east-1.snowflakecomputing.com";

const STATEMENTS_URL = `${SNOWFLAKE_ACCOUNT_URL}/api/v2/statements`;

export type FetchImpl = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type ExecuteDeps = {
  fetchImpl?: FetchImpl;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

type SnowflakeStatementResponse = {
  data?: string[][];
  message?: string;
  statementHandle?: string;
  resultSetMetaData?: { partitionInfo?: unknown[] };
};

function assertSinglePartition(json: SnowflakeStatementResponse): void {
  const partitions = json.resultSetMetaData?.partitionInfo?.length ?? 1;
  if (partitions > 1) {
    throw new Error(`Snowflake returned ${partitions} result partitions; pagination is not implemented`);
  }
}

function statementData(json: SnowflakeStatementResponse): string[][] {
  assertSinglePartition(json);
  return json.data!;
}

async function readJson(res: Response): Promise<{ json: SnowflakeStatementResponse; snippet: string }> {
  const text = await res.text();
  const snippet = text.slice(0, 200);
  try {
    return { json: JSON.parse(text) as SnowflakeStatementResponse, snippet };
  } catch {
    return { json: {}, snippet };
  }
}

function throwHttpError(status: number, json: SnowflakeStatementResponse, snippet: string): never {
  if (status === 401 || status === 403) {
    throw new Error(`${status} auth/permission`);
  }
  if (json.message) throw new Error(`${status} ${json.message}`);
  throw new Error(`${status} ${snippet}`);
}

const POLL_MS = 1_000;
const TIMEOUT_MS = 120_000;

async function statementResult(
  res: Response,
  creds: SnowflakeCreds,
  deps: ExecuteDeps,
): Promise<string[][]> {
  const { json, snippet } = await readJson(res);
  if (res.status === 202) {
    const handle = json.statementHandle;
    if (!handle) throw new Error(`202 ${snippet}`);
    return pollStatement(handle, creds, deps);
  }
  if (!res.ok || json.data == null) {
    throwHttpError(res.status, json, snippet);
  }
  return statementData(json);
}

async function pollStatement(handle: string, creds: SnowflakeCreds, deps: ExecuteDeps): Promise<string[][]> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms: number) => Bun.sleep(ms));
  const deadline = now() + TIMEOUT_MS;
  const url = `${STATEMENTS_URL}/${handle}`;
  for (;;) {
    if (now() >= deadline) throw new Error("Snowflake statement timed out");
    await sleep(POLL_MS);
    if (now() >= deadline) throw new Error("Snowflake statement timed out");
    const res = await fetchImpl(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${creds.pat}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    });
    const { json, snippet } = await readJson(res);
    if (res.status === 202) continue;
    if (!res.ok || json.data == null) {
      throwHttpError(res.status, json, snippet);
    }
    return statementData(json);
  }
}

export async function executeStatement(
  sql: string,
  creds: SnowflakeCreds,
  deps: ExecuteDeps = {},
): Promise<string[][]> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const res = await fetchImpl(STATEMENTS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${creds.pat}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      statement: sql,
      warehouse: "PROD_WH",
      database: "GOLD_PROD",
      schema: "MARTS",
      role: "TECH_ANALYST",
      timeout: 120,
    }),
  });
  return statementResult(res, creds, deps);
}

export const SESSION_SQL =
  "SELECT CURRENT_USER() AS current_user, CURRENT_ROLE() AS current_role, CURRENT_WAREHOUSE() AS current_warehouse";

export const EVENT_COUNTS_SQL = `SELECT source_event_type, COUNT(*) AS event_count
FROM gold_prod.marts.fct_amplitude_events
WHERE event_date BETWEEN DATEADD(day, -7, CURRENT_DATE()) AND CURRENT_DATE()
  AND is_amplitude_generated_event = FALSE
GROUP BY source_event_type
ORDER BY event_count DESC
LIMIT 50`;

export type SessionInfo = { user: string; role: string; warehouse: string };
export type EventCount = { sourceEventType: string; eventCount: number };

export async function sessionInfo(creds: SnowflakeCreds, deps: ExecuteDeps = {}): Promise<SessionInfo> {
  const rows = await executeStatement(SESSION_SQL, creds, deps);
  const row = rows[0];
  if (!row || row[0] == null || row[1] == null || row[2] == null) {
    throw new Error("Snowflake session query returned no row");
  }
  return { user: row[0], role: row[1], warehouse: row[2] };
}

export async function eventCountsLast7d(creds: SnowflakeCreds, deps: ExecuteDeps = {}): Promise<EventCount[]> {
  const rows = await executeStatement(EVENT_COUNTS_SQL, creds, deps);
  return rows.map((row) => ({
    sourceEventType: row[0] ?? "",
    eventCount: Number.parseInt(row[1] ?? "0", 10) || 0,
  }));
}

export function formatSession(info: SessionInfo): string {
  return `user=${info.user} role=${info.role} warehouse=${info.warehouse}`;
}

export function formatEventCounts(rows: EventCount[]): string {
  return rows.map((r) => `${r.sourceEventType}\t${r.eventCount}`).join("\n");
}
