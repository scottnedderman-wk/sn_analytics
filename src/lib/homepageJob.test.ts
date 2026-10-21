import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openAppDatabase } from "./db";
import { missingVolumeDays } from "./eventVolumeCache";
import { readHomepageJob, resumeHomepageRefresh } from "./homepageJob";
import type { DashboardData } from "./model";

function tmpDb() {
  const dir = mkdtempSync(join(tmpdir(), "sn-analytics-"));
  const db = openAppDatabase(join(dir, "app.sqlite"));
  return { dir, db };
}

test("resumeHomepageRefresh continues a running job and does not start a second one", async () => {
  const { dir, db } = tmpDb();
  try {
    const data: DashboardData = { provenance: "t", repos: [] };
    db.prepare(
      `INSERT INTO homepage_refresh_job (
         id, status, window_start, window_end, completed, total, message, error, started_at, updated_at, finished_at
       ) VALUES (1, 'running', '2026-08-17', '2026-08-18', 0, 0, 'Preparing refresh…', NULL, ?, ?, NULL)`,
    ).run("2026-08-20T00:00:00.000Z", "2026-08-20T00:00:00.000Z");
    let reads = 0;
    const deps = {
      db,
      readData: () => {
        reads += 1;
        return data;
      },
      now: () => new Date("2026-08-20T16:00:00Z"),
    };
    resumeHomepageRefresh(deps);
    resumeHomepageRefresh(deps);
    for (let i = 0; i < 100 && readHomepageJob(db).status === "running"; i++) {
      await Bun.sleep(5);
    }
    const job = readHomepageJob(db);
    expect(job.status).toBe("done");
    expect(job.message).toBe("Volumes ready");
    expect(reads).toBe(1);
    expect(missingVolumeDays(db, "amp", { start: "2026-08-17", end: "2026-08-18" })).toEqual([]);
    expect(missingVolumeDays(db, "ai", { start: "2026-08-17", end: "2026-08-18" })).toEqual([]);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
