import { expect, test } from "bun:test";
import type { DashboardData } from "@/lib/model";
import { homepageRoutes } from "./homepage";

test("POST /api/homepage/refresh returns data on success and 500 without write on error", async () => {
  const seed: DashboardData = { provenance: "t", repos: [] };
  let wrote = false;
  const ok = homepageRoutes({
    readData: () => seed,
    writeData: async () => {
      wrote = true;
    },
    credsFromEnv: () => ({ pat: "tok" }),
    fetchImpl: async () =>
      new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    now: () => new Date("2026-08-26T16:00:00Z"),
  })["/api/homepage/refresh"].POST;
  const res = await ok();
  expect(res.status).toBe(200);
  const body = (await res.json()) as { data: DashboardData };
  expect(body.data.volumeAsOf).toBe("2026-08-24");
  expect(wrote).toBe(true);

  wrote = false;
  const bad = homepageRoutes({
    readData: () => seed,
    writeData: async () => {
      wrote = true;
    },
    credsFromEnv: () => ({ pat: "tok" }),
    fetchImpl: async () => new Response("nope", { status: 500 }),
    now: () => new Date("2026-08-26T16:00:00Z"),
  })["/api/homepage/refresh"].POST;
  const err = await bad();
  expect(err.status).toBe(500);
  const errorBody = (await err.json()) as { error: string };
  expect(typeof errorBody.error).toBe("string");
  expect(wrote).toBe(false);
});
