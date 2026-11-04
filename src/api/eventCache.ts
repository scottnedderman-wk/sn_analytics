import type { Database } from "bun:sqlite";
import { cachedAnalysisEventNames } from "@/lib/eventAnalysisCache";
import { cachedExampleEventNames } from "@/lib/eventExampleCache";
import { parseDayWindow, type DayWindow } from "@/lib/volumeWindow";

function decodeRouteParam(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function cachedEventsResponse(db: Database, repo: string, window: DayWindow) {
  return {
    analyses: cachedAnalysisEventNames(db, repo, window),
    examples: cachedExampleEventNames(db, repo, window),
  };
}

export function eventCacheRoutes(db: Database) {
  return {
    "/api/repos/:repo/cached-events": {
      GET(req: Request & { params: { repo: string } }) {
        const url = new URL(req.url);
        let window;
        try {
          window = parseDayWindow({
            start: url.searchParams.get("start"),
            end: url.searchParams.get("end"),
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return Response.json({ error: message }, { status: 400 });
        }
        return Response.json(cachedEventsResponse(db, decodeRouteParam(req.params.repo), window));
      },
    },
  };
}
