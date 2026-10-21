import { ThemeToggle } from "@/components/ui";
import { canApplyWindow } from "@/lib/volumeWindow";
import { DIFF_TOLERANCES, useVolumeWindow } from "./VolumeWindowContext";

export function RefreshProgress({
  completed,
  total,
  message,
}: {
  completed: number;
  total: number;
  message: string;
}) {
  const pct =
    total > 0 ? Math.min(100, Math.round((100 * completed) / total)) : 0;
  return (
    <div className="mt-2 w-full">
      <div className="mb-1 flex items-center justify-between gap-3 text-[11px] txt-2">
        <span
          className={completed === 0 ? "animate-pulse" : undefined}
          aria-live="polite"
        >
          {message}
        </span>
        {total > 0 ? (
          <span className="tabular-nums shrink-0">
            {completed}/{total}
          </span>
        ) : null}
      </div>
      <div
        className="h-1.5 overflow-hidden rounded-full"
        style={{ background: "var(--border)" }}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={Math.max(total, 1)}
        aria-valuenow={completed}
        aria-label={message}
      >
        <div
          className="h-full rounded-full bg-blue-600"
          style={{ width: total > 0 ? `${pct}%` : "30%" }}
        />
      </div>
    </div>
  );
}

export function AppHeader({
  theme,
  onToggleTheme,
}: {
  theme: "light" | "dark";
  onToggleTheme: () => void;
}) {
  const {
    draft,
    applied,
    setDraft,
    apply,
    tolerance,
    setTolerance,
    job,
    busy,
    error,
  } = useVolumeWindow();
  const canApply = canApplyWindow(draft, applied) && !busy;
  const progress =
    job?.status === "running"
      ? {
          completed: job.completed,
          total: job.total,
          message: job.window
            ? `${job.window.start} – ${job.window.end} · ${job.message}`
            : job.message,
        }
      : null;

  return (
    <div
      className="sticky top-0 z-30 -mx-5 mb-4 border-b px-5 pb-3 pt-5"
      style={{ background: "var(--surface-3)", borderColor: "var(--border)" }}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h1 className="text-[21px] font-bold tracking-tight">
          Analytics Migration
        </h1>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <label className="flex items-center gap-1.5 text-[12px] txt-2">
            <span className="whitespace-nowrap">Tolerance (%)</span>
            <select
              aria-label="Diff tolerance"
              value={tolerance}
              onChange={(e) => setTolerance(Number(e.target.value))}
              className="surf border rounded-md px-2 py-1.5 text-[12px] font-medium outline-none focus:ring-2 focus:ring-blue-500/40"
            >
              {DIFF_TOLERANCES.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <div className="ml-6 flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1.5 text-[12px] txt-2">
              <span className="whitespace-nowrap">Start</span>
              <input
                type="date"
                aria-label="Window start date"
                value={draft.start}
                max={draft.end || undefined}
                onChange={(e) => setDraft({ ...draft, start: e.target.value })}
                className="surf border rounded-md px-2 py-1.5 text-[12px] font-medium outline-none focus:ring-2 focus:ring-blue-500/40"
              />
            </label>
            <label className="flex items-center gap-1.5 text-[12px] txt-2">
              <span className="whitespace-nowrap">End</span>
              <input
                type="date"
                aria-label="Window end date"
                value={draft.end}
                min={draft.start || undefined}
                onChange={(e) => setDraft({ ...draft, end: e.target.value })}
                className="surf border rounded-md px-2 py-1.5 text-[12px] font-medium outline-none focus:ring-2 focus:ring-blue-500/40"
              />
            </label>
            <button
              type="button"
              aria-label="Apply date window"
              aria-busy={busy}
              disabled={!canApply}
              onClick={() => void apply()}
              className="surf border rounded-md px-2.5 py-1.5 text-[12px] font-medium hover:opacity-80 disabled:opacity-40"
            >
              Apply
            </button>
          </div>
          <span className="hidden">
            <ThemeToggle theme={theme} onToggle={onToggleTheme} />
          </span>
        </div>
      </div>
      {progress ? <RefreshProgress {...progress} /> : null}
      {error ? (
        <p
          className="text-right text-[11px] mt-0.5"
          style={{ color: "var(--st-critical-ink)" }}
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
