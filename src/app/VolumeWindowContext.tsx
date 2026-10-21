import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { HomepageJob } from "@/lib/homepageJob";
import type { DashboardData } from "@/lib/model";
import { canApplyWindow, DEFAULT_VOLUME_WINDOW, type DayWindow } from "@/lib/volumeWindow";

export const DIFF_TOLERANCES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;
export const DEFAULT_DIFF_TOLERANCE = 5;

type VolumeWindowValue = {
  draft: DayWindow;
  applied: DayWindow | null;
  setDraft: (next: DayWindow) => void;
  apply: () => Promise<void>;
  loadWindow: (window: DayWindow) => Promise<void>;
  tolerance: number;
  setTolerance: (next: number) => void;
  job: HomepageJob | null;
  busy: boolean;
  error: string | null;
};

const VolumeWindowContext = createContext<VolumeWindowValue | null>(null);

function jobToken(job: HomepageJob): string {
  return `${job.finishedAt ?? ""}|${job.window?.start ?? ""}|${job.window?.end ?? ""}|${job.updatedAt ?? ""}`;
}

async function fetchJob(): Promise<HomepageJob> {
  const res = await fetch("/api/homepage/job");
  const body = (await res.json()) as { job?: HomepageJob; error?: string };
  if (!res.ok || !body.job) throw new Error(body.error ?? res.statusText);
  return body.job;
}

async function fetchVolumes(window: DayWindow): Promise<DashboardData> {
  const params = new URLSearchParams({ start: window.start, end: window.end });
  const res = await fetch(`/api/homepage/volumes?${params}`);
  const body = (await res.json()) as { data?: DashboardData; error?: string };
  if (!res.ok || !body.data) throw new Error(body.error ?? res.statusText);
  return body.data;
}

export function VolumeWindowProvider({
  children,
  onData,
}: {
  children: ReactNode;
  onData: (data: DashboardData) => void;
}) {
  const [applied, setApplied] = useState<DayWindow | null>(null);
  const [draft, setDraft] = useState<DayWindow>(DEFAULT_VOLUME_WINDOW);
  const [job, setJob] = useState<HomepageJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tolerance, setTolerance] = useState(DEFAULT_DIFF_TOLERANCE);
  const [watch, setWatch] = useState(0);
  const loadedToken = useRef<string | null>(null);
  const restored = useRef(false);
  const busy = job?.status === "running";

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function loadDone(next: HomepageJob) {
      if (!next.window) return;
      const token = jobToken(next);
      if (loadedToken.current === token) return;
      loadedToken.current = token;
      try {
        const data = await fetchVolumes(next.window);
        if (cancelled) return;
        onData(data);
        setApplied(next.window);
        setDraft(next.window);
      } catch (err) {
        loadedToken.current = null;
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    }

    async function poll() {
      try {
        const next = await fetchJob();
        if (cancelled) return;
        setJob(next);
        if (!restored.current && next.window && (next.status === "running" || next.status === "done")) {
          restored.current = true;
          setDraft(next.window);
        }
        if (next.status === "running") {
          setError(null);
          timer = setTimeout(() => void poll(), 1000);
          return;
        }
        if (next.status === "error") {
          setError(next.error ?? "Refresh failed");
          return;
        }
        if (next.status === "done") {
          setError(null);
          await loadDone(next);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    }

    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [onData, watch]);

  async function loadWindow(window: DayWindow) {
    if (busy) return;
    setError(null);
    try {
      const res = await fetch("/api/homepage/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(window),
      });
      const body = (await res.json()) as { job?: HomepageJob; data?: DashboardData; error?: string };
      if (!res.ok || !body.job) {
        setError(body.error ?? res.statusText);
        return;
      }
      setJob(body.job);
      if (body.job.window) setDraft(body.job.window);
      if (body.data && body.job.window) {
        onData(body.data);
        setApplied(body.job.window);
        loadedToken.current = jobToken(body.job);
        return;
      }
      if (body.job.status === "error") {
        setError(body.job.error ?? "Refresh failed");
        return;
      }
      if (body.job.status === "running") setWatch((n) => n + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function apply() {
    if (!canApplyWindow(draft, applied) || busy) return;
    await loadWindow(draft);
  }

  return (
    <VolumeWindowContext.Provider
      value={{ draft, applied, setDraft, apply, loadWindow, tolerance, setTolerance, job, busy, error }}
    >
      {children}
    </VolumeWindowContext.Provider>
  );
}

export function useVolumeWindow(): VolumeWindowValue {
  const ctx = useContext(VolumeWindowContext);
  if (!ctx) throw new Error("useVolumeWindow requires VolumeWindowProvider");
  return ctx;
}
