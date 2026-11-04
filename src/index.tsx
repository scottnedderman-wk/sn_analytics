import { serve } from "bun";
import { compareRoutes } from "@/api/compare";
import { contributorsRoutes } from "@/api/contributors";
import { eventCacheRoutes } from "@/api/eventCache";
import { eventAnalysisRoutes } from "@/api/eventAnalysis";
import { eventSampleRoutes } from "@/api/eventSample";
import { eventVolumeRoutes } from "@/api/eventVolume";
import { helloRoutes } from "@/api/hello";
import { homepageRoutes } from "@/api/homepage";
import { seedJsonUrl } from "@/lib/dataPath";
import { openAppDatabase, sqlitePathFromEnv } from "@/lib/db";
import { resumeHomepageRefresh } from "@/lib/homepageJob";
import { listenPort, SERVE_IDLE_TIMEOUT_SECONDS } from "@/lib/port";
import index from "./index.html";

const db = openAppDatabase(sqlitePathFromEnv());
resumeHomepageRefresh({ db });

const server = serve({
  port: listenPort(),
  idleTimeout: SERVE_IDLE_TIMEOUT_SECONDS,
  routes: {
    "/seed.json": () =>
      new Response(Bun.file(seedJsonUrl), {
        headers: { "Content-Type": "application/json; charset=utf-8" },
      }),

    // Serve index.html for all unmatched routes.
    "/*": index,

    ...helloRoutes(),
    ...compareRoutes(db),
    ...contributorsRoutes(db),
    ...eventVolumeRoutes(db),
    ...eventSampleRoutes(db),
    ...eventAnalysisRoutes(db),
    ...eventCacheRoutes(db),
    ...homepageRoutes({ db }),
  },

  development: process.env.NODE_ENV !== "production" && {
    // Enable browser hot reloading in development
    hmr: true,

    // Echo console logs from the browser to the server
    console: true,
  },
});

console.log(`🚀 Server running at ${server.url}`);
