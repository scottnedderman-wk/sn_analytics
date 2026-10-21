import { serve } from "bun";
import { compareRoutes } from "@/api/compare";
import { helloRoutes } from "@/api/hello";
import { homepageRoutes } from "@/api/homepage";
import { dataJsonUrl } from "@/lib/dataPath";
import { openAppDatabase, sqlitePathFromEnv } from "@/lib/db";
import { listenPort, SERVE_IDLE_TIMEOUT_SECONDS } from "@/lib/port";
import index from "./index.html";

const db = openAppDatabase(sqlitePathFromEnv());

const server = serve({
  port: listenPort(),
  idleTimeout: SERVE_IDLE_TIMEOUT_SECONDS,
  routes: {
    "/data.json": () =>
      new Response(Bun.file(dataJsonUrl), {
        headers: { "Content-Type": "application/json; charset=utf-8" },
      }),

    // Serve index.html for all unmatched routes.
    "/*": index,

    ...helloRoutes(),
    ...compareRoutes(db),
    ...homepageRoutes(),
  },

  development: process.env.NODE_ENV !== "production" && {
    // Enable browser hot reloading in development
    hmr: true,

    // Echo console logs from the browser to the server
    console: true,
  },
});

console.log(`🚀 Server running at ${server.url}`);
