import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openAppDatabase } from "@/lib/db";
import { markVolumeDaysFetched, missingVolumeDays } from "@/lib/eventVolumeCache";
import { readHomepageJob } from "@/lib/homepageJob";
import type { DashboardData } from "@/lib/model";
import { homepageRoutes } from "./homepage";

const window = { start: "2026-08-17", end: "2026-08-18" };

function tmpDb() {
  const dir = mkdtempSync(join(tmpdir(), "sn-analytics-"));
  const db = openAppDatabase(join(dir, "app.sqlite"));
  return { dir, db };
}

function catalog(): DashboardData {
  return {
    provenance: "t",
    repos: [
      {
        repo: "wdesk_sdk",
        events: [
          {
            name: "General Experience Loading",
            legacy: [],
            status: "missing",
            v30: 0,
            v365: 0,
            dev30: 0,
            merged: false,
            pr: null,
            amp_count: null,
            ss_error: "",
            queried: 0,
          },
        ],
        counts: { missing: 1 },
        total: 1,
        live: 0,
        volume30: 0,
        sources: [],
        prs: [],
        inv_mapped: 0,
        inv_unmapped: 0,
      },
    ],
  };
}

function post(handler: (req: Request) => Promise<Response>, body: unknown) {
  return handler(
    new Request("http://localhost/api/homepage/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

async function waitTerminal(db: ReturnType<typeof openAppDatabase>) {
  for (let i = 0; i < 100; i++) {
    const job = readHomepageJob(db);
    if (job.status === "done" || job.status === "error") return job;
    await Bun.sleep(5);
  }
  throw new Error(`job did not finish: ${readHomepageJob(db).message}`);
}

test("POST /api/homepage/refresh returns cached volumes without leaving a running job", async () => {
  const { dir, db } = tmpDb();
  try {
    markVolumeDaysFetched(db, "amp", ["2026-08-17", "2026-08-18"], "2026-08-20T00:00:00.000Z");
    markVolumeDaysFetched(db, "ai", ["2026-08-17", "2026-08-18"], "2026-08-20T00:00:00.000Z");
    const ok = homepageRoutes({
      db,
      readData: () => catalog(),
      now: () => new Date("2026-08-26T16:00:00Z"),
    })["/api/homepage/refresh"].POST;
    const res = await post(ok, window);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { job: { status: string }; data: DashboardData };
    expect(body.job.status).toBe("done");
    expect(body.data.volumeAsOf).toBe("2026-08-18");
    expect(body.data.volumeWindowDays).toBe(2);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("POST /api/homepage/refresh returns 400 for a bad window", async () => {
  const { dir, db } = tmpDb();
  try {
    const handler = homepageRoutes({
      db,
      readData: () => ({ provenance: "t", repos: [] }),
    })["/api/homepage/refresh"].POST;
    const res = await post(handler, { start: "2026-08-18", end: "2026-08-17" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("start must be on or before end");
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("POST /api/homepage/refresh keeps running after the response and survives a second read", async () => {
  const { dir, db } = tmpDb();
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  try {
    let calls = 0;
    const routes = homepageRoutes({
      db,
      readData: () => catalog(),
      credsFromEnv: () => ({ pat: "tok" }),
      fetchImpl: async () => {
        calls += 1;
        await gate;
        return Response.json({ data: [["General Experience Loading", "2026-08-17", "4"]] });
      },
      now: () => new Date("2026-08-26T16:00:00Z"),
    });
    const res = await post(routes["/api/homepage/refresh"].POST, window);
    expect(res.status).toBe(200);
    const started = (await res.json()) as { job: { status: string; message: string }; data?: unknown };
    expect(started.job.status).toBe("running");
    expect(started.data).toBeUndefined();

    const again = await post(routes["/api/homepage/refresh"].POST, {
      start: "2026-08-01",
      end: "2026-08-02",
    });
    const joined = (await again.json()) as { job: { window: { start: string } } };
    expect(joined.job.window.start).toBe("2026-08-17");

    const jobRes = routes["/api/homepage/job"].GET();
    const polled = (await (await jobRes).json()) as { job: { status: string; message: string } };
    expect(polled.job.status).toBe("running");

    release();
    const finished = await waitTerminal(db);
    expect(finished.status).toBe("done");
    expect(calls).toBe(1);

    const volumes = await routes["/api/homepage/volumes"].GET(
      new Request("http://localhost/api/homepage/volumes?start=2026-08-17&end=2026-08-18"),
    );
    expect(volumes.status).toBe(200);
    const body = (await volumes.json()) as { data: DashboardData };
    expect(body.data.repos[0]!.events[0]!.v30).toBe(4);
    expect(body.data.volumeAsOf).toBe("2026-08-18");
  } finally {
    release();
    const finished = readHomepageJob(db);
    if (finished.status === "running") await waitTerminal(db);
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a failed Snowflake fetch records the error and leaves those days missing", async () => {
  const { dir, db } = tmpDb();
  try {
    const routes = homepageRoutes({
      db,
      readData: () => catalog(),
      credsFromEnv: () => ({ pat: "tok" }),
      fetchImpl: async () => new Response("nope", { status: 500 }),
      now: () => new Date("2026-08-26T16:00:00Z"),
    });
    const res = await post(routes["/api/homepage/refresh"].POST, window);
    expect(res.status).toBe(200);
    const started = (await res.json()) as { job: { status: string } };
    expect(started.job.status).toBe("running");
    const finished = await waitTerminal(db);
    expect(finished.status).toBe("error");
    expect(finished.error).toEqual(expect.any(String));
    expect(missingVolumeDays(db, "amp", window)).toEqual(["2026-08-17", "2026-08-18"]);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
