import type { Database } from "bun:sqlite";
import { listEventVolumeDaily, listRepoVolumeDaily } from "@/lib/eventVolumeCache";
import { parseDayWindow, type DayWindow } from "@/lib/volumeWindow";

function decodeRouteParam(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function eventVolumeGetResponse(
  db: Database,
  repo: string,
  eventName: string,
  window: DayWindow,
) {
  return {
    rows: listEventVolumeDaily(db, repo, eventName, window).map((row) => ({
      source: row.source,
      day: row.day,
      count: row.count,
    })),
  };
}

export function repoVolumeGetResponse(db: Database, repo: string, window: DayWindow) {
  return {
    rows: listRepoVolumeDaily(db, repo, window).map((row) => ({
      eventName: row.eventName,
      source: row.source,
      day: row.day,
      count: row.count,
    })),
  };
}

export function eventVolumeRoutes(db: Database) {
  return {
    "/api/repos/:repo/volume": {
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
        return Response.json(repoVolumeGetResponse(db, decodeRouteParam(req.params.repo), window));
      },
    },
    "/api/repos/:repo/events/:eventName/volume": {
      GET(req: Request & { params: { repo: string; eventName: string } }) {
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
        return Response.json(
          eventVolumeGetResponse(db, decodeRouteParam(req.params.repo), decodeRouteParam(req.params.eventName), window),
        );
      },
    },
  };
}
