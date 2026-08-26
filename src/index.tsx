import { serve } from "bun";
import index from "./index.html";
import { openAppDatabase, sqlitePathFromEnv } from "./db";
import { compareRoutes } from "./eventCompareApi";
import { listenPort } from "./port";

const db = openAppDatabase(sqlitePathFromEnv());

const server = serve({
  port: listenPort(),
  routes: {
    "/data.json": () =>
      new Response(Bun.file(new URL("./data.json", import.meta.url)), {
        headers: { "Content-Type": "application/json; charset=utf-8" },
      }),

    // Serve index.html for all unmatched routes.
    "/*": index,

    "/api/hello": {
      async GET(req) {
        return Response.json({
          message: "Hello, world!",
          method: "GET",
        });
      },
      async PUT(req) {
        return Response.json({
          message: "Hello, world!",
          method: "PUT",
        });
      },
    },

    "/api/hello/:name": async req => {
      const name = req.params.name;
      return Response.json({
        message: `Hello, ${name}!`,
      });
    },

    ...compareRoutes(db),
  },

  development: process.env.NODE_ENV !== "production" && {
    // Enable browser hot reloading in development
    hmr: true,

    // Echo console logs from the browser to the server
    console: true,
  },
});

console.log(`🚀 Server running at ${server.url}`);
