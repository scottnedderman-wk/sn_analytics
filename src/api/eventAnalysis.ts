import type { Database } from "bun:sqlite";
import { analysisDay, loadEventAnalysis } from "@/lib/eventAnalysis";
import { loadCachedEventAnalysis } from "@/lib/eventAnalysisCache";
import { listEventVolumeDaily } from "@/lib/eventVolumeCache";
import { findSeedEvent } from "@/lib/eventSample";
import { readDashboardFile } from "@/lib/homepageRefresh";
import { AI_STATEMENT_SESSION, credsFromEnv, executeStatement } from "@/lib/snowflakeEvents";
import { parseDayWindow } from "@/lib/volumeWindow";

function decodeRouteParam(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function eventAnalysisRoutes(db: Database) {
  return {
    "/api/repos/:repo/events/:eventName/analysis": {
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
        const rows = listEventVolumeDaily(db, repo, event.name, window);
        const day = analysisDay(
          event,
          window,
          rows.map((row) => ({ source: row.source, day: row.day, count: row.count })),
        );
        try {
          const creds = credsFromEnv();
          return Response.json(
            await loadCachedEventAnalysis(db, repo, event.name, window, () =>
              loadEventAnalysis(event, day, (sql, source) =>
                executeStatement(sql, creds, { session: source === "ai" ? AI_STATEMENT_SESSION : undefined }),
              ),
            ),
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return Response.json({ error: message }, { status: 502 });
        }
      },
    },
  };
}
