import { useEffect, useRef, useState } from "react";
import type { AnalysisSection, EventAnalysis } from "@/lib/eventAnalysis";
import { DIFF_INK, diffTone } from "@/routes/dashboard/AppSummary";
import type { MigrationEvent } from "@/lib/model";
import type { DayWindow } from "@/lib/volumeWindow";

function cellInk(text: string, tolerance: number): string | undefined {
  const match = /^(-?\d+)%$/.exec(text);
  if (!match) return undefined;
  const tone = diffTone(Number(match[1]), tolerance);
  return tone ? DIFF_INK[tone] : undefined;
}

const EXPECTED_ANALYSIS_MS = 45_000;

export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes === 0 ? `${seconds}s` : `${minutes}m ${rest}s`;
}

function AnalysisProgress({ elapsedMs }: { elapsedMs: number }) {
  const pct = Math.min(92, (elapsedMs / EXPECTED_ANALYSIS_MS) * 100);
  return (
    <div>
      <p className="text-[13px] tabular-nums" style={{ color: "var(--text-primary)" }}>
        {`Analyzing… ${formatDuration(elapsedMs)}`}
      </p>
      <div
        role="progressbar"
        aria-label="Analysis progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
        aria-valuetext={formatDuration(elapsedMs)}
        className="mt-3 h-2 overflow-hidden rounded"
        style={{ background: "var(--grid)" }}
      >
        <div className="h-full rounded" style={{ width: `${pct}%`, background: "var(--st-info)" }} />
      </div>
      <p className="text-[13px] leading-relaxed mt-3" style={{ color: "var(--text-secondary)" }}>
        Please be patient. This can take about a minute. The result will be cached, so opening it again is immediate.
      </p>
    </div>
  );
}

function AnalysisBlock({ section, tolerance }: { section: AnalysisSection; tolerance: number }) {
  return (
    <section>
      <h3 className="text-[15px] font-semibold">{section.title}</h3>
      {section.paragraphs.map((paragraph) => (
        <p key={paragraph} className="text-[13px] leading-relaxed mt-2" style={{ color: "var(--text-secondary)" }}>
          {paragraph}
        </p>
      ))}
      {section.table ? (
        <table className="w-full text-left border-collapse text-[13px] mt-3">
          <thead>
            <tr>
              {section.table.columns.map((column) => (
                <th
                  key={column.label}
                  scope="col"
                  className={`py-2 pr-3 font-semibold text-[11px] uppercase tracking-wider ${column.align === "right" ? "text-right" : "text-left"}`}
                  style={{ background: "var(--surface-3)", color: "var(--text-secondary)" }}
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {section.table.rows.map((row) => (
              <tr key={row.cells.join("|")} className="border-t" style={{ borderColor: "var(--grid)" }}>
                {row.cells.map((cell, index) => {
                  const align = section.table?.columns[index]?.align === "right";
                  const ink = cellInk(cell, tolerance);
                  return (
                    <td
                      key={`${row.cells[0]}-${index}`}
                      className={`py-1.5 pr-3 align-top ${align ? "text-right tabular-nums" : ""}`}
                      style={ink ? { color: ink } : undefined}
                    >
                      {cell}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </section>
  );
}

export function EventAnalysisModal({
  event,
  repo,
  applied,
  tolerance,
  analysis: analysisProp,
  onCached,
  onClose,
}: {
  event: MigrationEvent;
  repo: string;
  applied: DayWindow | null;
  tolerance: number;
  analysis?: EventAnalysis | null;
  onCached?: () => void;
  onClose: () => void;
}): JSX.Element {
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const onCachedRef = useRef(onCached);
  onCachedRef.current = onCached;
  const [analysis, setAnalysis] = useState<EventAnalysis | null>(analysisProp ?? null);
  const [error, setError] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const waiting = analysisProp === undefined && applied != null && analysis == null && error == null;

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCloseRef.current();
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      previous?.focus();
    };
  }, []);

  useEffect(() => {
    if (analysisProp !== undefined || !applied) return;
    let cancelled = false;
    setAnalysis(null);
    setError(null);
    const params = new URLSearchParams({ start: applied.start, end: applied.end });
    fetch(`/api/repos/${encodeURIComponent(repo)}/events/${encodeURIComponent(event.name)}/analysis?${params}`)
      .then(async (res) => {
        const body = (await res.json()) as EventAnalysis & { error?: string };
        if (!res.ok) throw new Error(body.error ?? res.statusText);
        return body;
      })
      .then((body) => {
        if (!cancelled) setAnalysis(body);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [analysisProp, applied, repo, event.name]);

  useEffect(() => {
    if (analysis) onCachedRef.current?.();
  }, [analysis]);

  useEffect(() => {
    if (!waiting) return;
    const started = Date.now();
    setElapsedMs(0);
    const timer = setInterval(() => setElapsedMs(Date.now() - started), 200);
    return () => clearInterval(timer);
  }, [waiting, event.name]);

  return (
    <>
      <button
        type="button"
        aria-label="Close"
        className="fixed inset-0 z-40"
        style={{ background: "rgba(11, 11, 11, 0.45)" }}
        onClick={onClose}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="event-analysis-title"
        tabIndex={-1}
        className="surf border rounded-lg fixed z-50 inset-x-4 top-8 mx-auto w-[80vw] max-h-[calc(100vh-4rem)] overflow-y-auto p-5 outline-none"
        style={{ background: "var(--surface-1)", borderColor: "var(--border)" }}
      >
        <header className="flex items-start justify-between gap-4 mb-5 pb-4 border-b" style={{ borderColor: "var(--border)" }}>
          <div className="min-w-0">
            <h2 id="event-analysis-title" className="text-[20px] font-bold tracking-tight">
              Volume analysis
            </h2>
            <p className="text-[16px] font-semibold mt-1">{event.name}</p>
            {analysis ? (
              <p className="text-[13px] mt-1 tabular-nums" style={{ color: "var(--text-secondary)" }}>
                {analysis.durationMs == null ? analysis.day : `${analysis.day} · Produced in ${formatDuration(analysis.durationMs)}`}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            className="surf border rounded-md px-2.5 py-1 text-[12px] font-medium hover:opacity-80"
            onClick={onClose}
          >
            Close
          </button>
        </header>
        {error ? (
          <p className="text-[13px]" style={{ color: "var(--st-critical-ink)" }}>
            {error}
          </p>
        ) : analysis ? (
          <div className="space-y-6">
            {analysis.sections.map((section) => (
              <AnalysisBlock key={section.title} section={section} tolerance={tolerance} />
            ))}
          </div>
        ) : waiting ? (
          <AnalysisProgress elapsedMs={elapsedMs} />
        ) : (
          <p className="text-[13px]" style={{ color: "var(--text-secondary)" }}>
            Analyzing…
          </p>
        )}
      </div>
    </>
  );
}
