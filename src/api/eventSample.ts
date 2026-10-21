import type { Database } from "bun:sqlite";
import { loadCachedEventSample } from "@/lib/eventExampleCache";
import { findSeedEvent, queryEventSample } from "@/lib/eventSample";
import { readDashboardFile } from "@/lib/homepageRefresh";
import { parseDayWindow } from "@/lib/volumeWindow";

function decodeRouteParam(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function eventSampleRoutes(db: Database) {
  return {
    "/api/repos/:repo/events/:eventName/sample": {
      async GET(req: Request & { params: { repo: string; eventName: string } }) {
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
        const repo = decodeRouteParam(req.params.repo);
        const eventName = decodeRouteParam(req.params.eventName);
        const event = findSeedEvent(await readDashboardFile(), repo, eventName);
        if (!event) return Response.json({ error: "Unknown event" }, { status: 404 });
        try {
          return Response.json(
            await loadCachedEventSample(db, repo, event, window, () => queryEventSample(event, window)),
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return Response.json({ error: message }, { status: 502 });
        }
      },
    },
  };
}
