import type { Database } from "bun:sqlite";
import { listVolumeDaily, missingVolumeDays } from "./eventVolumeCache";
import { applyVolumeDaily } from "./homepageVolumes";
import {
  readDashboardFile,
  refreshHomepageData,
  type HomepageRefreshDeps,
  type RefreshProgress,
} from "./homepageRefresh";
import type { DashboardData } from "./model";
import type { DayWindow } from "./volumeWindow";

export type HomepageJobStatus = "idle" | "running" | "done" | "error";

export type HomepageJob = {
  status: HomepageJobStatus;
  window: DayWindow | null;
  completed: number;
  total: number;
  message: string;
  error: string | null;
  startedAt: string | null;
  updatedAt: string | null;
  finishedAt: string | null;
};

type JobRow = {
  status: string;
  window_start: string | null;
  window_end: string | null;
  completed: number;
  total: number;
  message: string;
  error: string | null;
  started_at: string | null;
  updated_at: string | null;
  finished_at: string | null;
};

const runners = new WeakMap<Database, Promise<void>>();

function idleJob(): HomepageJob {
  return {
    status: "idle",
    window: null,
    completed: 0,
    total: 0,
    message: "",
    error: null,
    startedAt: null,
    updatedAt: null,
    finishedAt: null,
  };
}

function mapJob(row: JobRow | null): HomepageJob {
  if (!row) return idleJob();
  const status: HomepageJobStatus =
    row.status === "running" || row.status === "done" || row.status === "error" ? row.status : "idle";
  return {
    status,
    window: row.window_start && row.window_end ? { start: row.window_start, end: row.window_end } : null,
    completed: row.completed,
    total: row.total,
    message: row.message,
    error: row.error,
    startedAt: row.started_at,
    updatedAt: row.updated_at,
    finishedAt: row.finished_at,
  };
}

export function readHomepageJob(db: Database): HomepageJob {
  const row = db
    .query(
      `SELECT status, window_start, window_end, completed, total, message, error, started_at, updated_at, finished_at
       FROM homepage_refresh_job WHERE id = 1`,
    )
    .get() as JobRow | null;
  return mapJob(row);
}

function saveJob(db: Database, job: HomepageJob): void {
  db.prepare(
    `INSERT INTO homepage_refresh_job (
       id, status, window_start, window_end, completed, total, message, error, started_at, updated_at, finished_at
     ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       status = excluded.status,
       window_start = excluded.window_start,
       window_end = excluded.window_end,
       completed = excluded.completed,
       total = excluded.total,
       message = excluded.message,
       error = excluded.error,
       started_at = excluded.started_at,
       updated_at = excluded.updated_at,
       finished_at = excluded.finished_at`,
  ).run(
    job.status,
    job.window?.start ?? null,
    job.window?.end ?? null,
    job.completed,
    job.total,
    job.message,
    job.error,
    job.startedAt,
    job.updatedAt,
    job.finishedAt,
  );
}

function stamp(deps: HomepageRefreshDeps): string {
  return (deps.now ?? (() => new Date()))().toISOString();
}

function writeProgress(db: Database, progress: RefreshProgress, updatedAt: string): void {
  db.prepare(
    `UPDATE homepage_refresh_job
     SET status = 'running', completed = ?, total = ?, message = ?, updated_at = ?
     WHERE id = 1`,
  ).run(progress.completed, progress.total, progress.message, updatedAt);
}

function finishJob(
  db: Database,
  status: "done" | "error",
  message: string,
  error: string | null,
  at: string,
): HomepageJob {
  const current = readHomepageJob(db);
  saveJob(db, {
    ...current,
    status,
    message,
    error,
    updatedAt: at,
    finishedAt: at,
  });
  return readHomepageJob(db);
}

async function runHomepageRefresh(deps: HomepageRefreshDeps): Promise<void> {
  const at = () => stamp(deps);
  try {
    await refreshHomepageData({
      ...deps,
      onProgress: (progress) => {
        writeProgress(deps.db, progress, at());
        console.log(`homepage ${progress.completed}/${progress.total} ${progress.message}`);
      },
    });
    finishJob(deps.db, "done", "Volumes ready", null, at());
    console.log("homepage refresh finished");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    finishJob(deps.db, "error", "Refresh failed", message, at());
    console.log(`homepage refresh failed: ${message.slice(0, 300)}`);
  }
}

function track(db: Database, deps: HomepageRefreshDeps): void {
  const run = runHomepageRefresh(deps).finally(() => {
    runners.delete(db);
  });
  runners.set(db, run);
}

export async function beginHomepageRefresh(
  deps: HomepageRefreshDeps,
): Promise<{ job: HomepageJob; data?: DashboardData }> {
  const current = readHomepageJob(deps.db);
  if (current.status === "running") return { job: current };

  const missingAmp = missingVolumeDays(deps.db, "amp", deps.window);
  const missingAi = missingVolumeDays(deps.db, "ai", deps.window);
  const startedAt = stamp(deps);
  saveJob(deps.db, {
    status: "running",
    window: deps.window,
    completed: 0,
    total: 0,
    message: missingAmp.length || missingAi.length ? "Preparing refresh…" : "Loading cached volumes",
    error: null,
    startedAt,
    updatedAt: startedAt,
    finishedAt: null,
  });

  if (!missingAmp.length && !missingAi.length) {
    try {
      const data = await refreshHomepageData(deps);
      return { job: finishJob(deps.db, "done", "Loaded from cache", null, stamp(deps)), data };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { job: finishJob(deps.db, "error", "Refresh failed", message, stamp(deps)) };
    }
  }

  track(deps.db, deps);
  return { job: readHomepageJob(deps.db) };
}

export function resumeHomepageRefresh(deps: Omit<HomepageRefreshDeps, "window">): void {
  const job = readHomepageJob(deps.db);
  if (job.status !== "running" || !job.window) return;
  if (runners.has(deps.db)) return;
  track(deps.db, { ...deps, window: job.window });
}

export async function loadCachedHomepageData(deps: HomepageRefreshDeps): Promise<DashboardData> {
  const readData = deps.readData ?? readDashboardFile;
  const job = readHomepageJob(deps.db);
  const refreshedAt = job.finishedAt ?? stamp(deps);
  const data = await readData();
  return applyVolumeDaily(data, listVolumeDaily(deps.db, deps.window), deps.window, refreshedAt);
}
