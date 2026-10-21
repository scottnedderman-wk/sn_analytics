import {
  beginHomepageRefresh,
  loadCachedHomepageData,
  readHomepageJob,
} from "@/lib/homepageJob";
import type { HomepageRefreshDeps } from "@/lib/homepageRefresh";
import { parseDayWindow } from "@/lib/volumeWindow";

export type HomepageRouteDeps = Omit<HomepageRefreshDeps, "window">;

function jsonError(err: unknown, status: number): Response {
  const message = err instanceof Error ? err.message : String(err);
  return Response.json({ error: message }, { status });
}

export function homepageRoutes(deps: HomepageRouteDeps) {
  return {
    "/api/homepage/job": {
      GET() {
        return Response.json({ job: readHomepageJob(deps.db) });
      },
    },
    "/api/homepage/volumes": {
      async GET(req: Request) {
        const url = new URL(req.url);
        let window;
        try {
          window = parseDayWindow({
            start: url.searchParams.get("start"),
            end: url.searchParams.get("end"),
          });
        } catch (err) {
          return jsonError(err, 400);
        }
        try {
          const data = await loadCachedHomepageData({ ...deps, window });
          return Response.json({ data });
        } catch (err) {
          return jsonError(err, 500);
        }
      },
    },
    "/api/homepage/refresh": {
      async POST(req: Request) {
        let body: unknown;
        try {
          body = await req.json();
        } catch {
          return Response.json({ error: "start and end dates are required" }, { status: 400 });
        }
        let window;
        try {
          window = parseDayWindow(body);
        } catch (err) {
          return jsonError(err, 400);
        }
        try {
          const result = await beginHomepageRefresh({ ...deps, window });
          return Response.json(result);
        } catch (err) {
          return jsonError(err, 500);
        }
      },
    },
  };
}
