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
};

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
  return json.data;
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
    return json.data;
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
