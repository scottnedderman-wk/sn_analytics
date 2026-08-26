import type { Database } from "bun:sqlite";
import { compareRowFromCache, type CompareRow } from "./eventCompare";
import { listCompareCache } from "./eventCompareCache";
import { refreshEventCompare, refreshRepoCompares } from "./eventCompareRefresh";
import { credsFromEnv } from "./snowflakeEvents";

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
): Promise<{ rows: CompareRow[] }> {
  const creds = credsFromEnv();
  const row = await refreshEventCompare(repo, eventName, db, creds);
  return { rows: [row] };
}

export async function compareRefreshRepo(
  db: Database,
  repo: string,
): Promise<{ rows: CompareRow[] }> {
  const creds = credsFromEnv();
  const rows = await refreshRepoCompares(repo, db, creds);
  return { rows };
}

function jsonError(err: unknown, status = 500): Response {
  const message = err instanceof Error ? err.message : String(err);
  return Response.json({ error: message }, { status });
}

export function compareRoutes(db: Database) {
  return {
    "/api/compare/:repo": {
      GET(req: { params: { repo: string } }) {
        return Response.json(compareGetResponse(db, req.params.repo));
      },
    },
    "/api/compare/:repo/refresh": {
      async POST(req: { params: { repo: string } }) {
        try {
          return Response.json(await compareRefreshRepo(db, req.params.repo));
        } catch (err) {
          return jsonError(err);
        }
      },
    },
    "/api/compare/:repo/events/:eventName/refresh": {
      async POST(req: { params: { repo: string; eventName: string } }) {
        try {
          const eventName = decodeURIComponent(req.params.eventName);
          return Response.json(await compareRefreshEvent(db, req.params.repo, eventName));
        } catch (err) {
          return jsonError(err);
        }
      },
    },
  };
}
