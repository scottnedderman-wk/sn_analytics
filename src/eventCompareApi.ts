import type { Database } from "bun:sqlite";
import { compareRowFromCache, type CompareRow } from "./eventCompare";
import { listCompareCache } from "./eventCompareCache";
import { refreshEventCompare, refreshRepoCompares, type RefreshDeps } from "./eventCompareRefresh";
import { credsFromEnv, type SnowflakeCreds } from "./snowflakeEvents";

export type CompareRouteDeps = RefreshDeps & {
  credsFromEnv?: () => SnowflakeCreds;
};

export function decodeRouteParam(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function compareGetResponse(db: Database, repo: string): { rows: CompareRow[] } {
  const rows = listCompareCache(db, repo).map((c) =>
    compareRowFromCache(c.eventName, c.snapshot, c.refreshedAt, c.lastError),
  );
  return { rows };
}

export async function compareRefreshEvent(
  db: Database,
  repo: string,
  eventName: string,
  deps?: CompareRouteDeps,
): Promise<{ rows: CompareRow[] }> {
  const creds = (deps?.credsFromEnv ?? credsFromEnv)();
  const row = await refreshEventCompare(repo, eventName, db, creds, deps);
  return { rows: [row] };
}

export async function compareRefreshRepo(
  db: Database,
  repo: string,
  deps?: CompareRouteDeps,
): Promise<{ rows: CompareRow[] }> {
  const creds = (deps?.credsFromEnv ?? credsFromEnv)();
  const rows = await refreshRepoCompares(repo, db, creds, deps);
  return { rows };
}

function jsonError(err: unknown, status = 500): Response {
  const message = err instanceof Error ? err.message : String(err);
  return Response.json({ error: message }, { status });
}

export function compareRoutes(db: Database, deps?: CompareRouteDeps) {
  return {
    "/api/compare/:repo": {
      GET(req: { params: { repo: string } }) {
        return Response.json(compareGetResponse(db, decodeRouteParam(req.params.repo)));
      },
    },
    "/api/compare/:repo/refresh": {
      async POST(req: { params: { repo: string } }) {
        try {
          const repo = decodeRouteParam(req.params.repo);
          return Response.json(await compareRefreshRepo(db, repo, deps));
        } catch (err) {
          return jsonError(err);
        }
      },
    },
    "/api/compare/:repo/events/:eventName/refresh": {
      async POST(req: { params: { repo: string; eventName: string } }) {
        try {
          const repo = decodeRouteParam(req.params.repo);
          const eventName = decodeRouteParam(req.params.eventName);
          return Response.json(await compareRefreshEvent(db, repo, eventName, deps));
        } catch (err) {
          return jsonError(err);
        }
      },
    },
  };
}
