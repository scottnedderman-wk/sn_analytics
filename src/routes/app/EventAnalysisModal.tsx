import { useEffect, useRef, useState } from "react";
import type { EventAnalysis } from "@/lib/eventAnalysis";
import { DIFF_INK, diffTone } from "@/routes/dashboard/AppSummary";
import type { MigrationEvent } from "@/lib/model";
import type { DayWindow } from "@/lib/volumeWindow";

function countText(n: number): string {
  return n.toLocaleString("en-US");
}

export function EventAnalysisModal({
  event,
  repo,
  applied,
  tolerance,
  analysis: analysisProp,
  onClose,
}: {
  event: MigrationEvent;
  repo: string;
  applied: DayWindow | null;
  tolerance: number;
  analysis?: EventAnalysis | null;
  onClose: () => void;
}): JSX.Element {
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [analysis, setAnalysis] = useState<EventAnalysis | null>(analysisProp ?? null);
  const [error, setError] = useState<string | null>(null);

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
        <header className="flex items-start justify-between gap-3 mb-4">
          <div>
            <h2 id="event-analysis-title" className="text-[18px] font-bold tracking-tight">
              {event.name}
            </h2>
            <p className="txt-2 text-[12px] mt-1">Volume analysis</p>
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
          <p className="text-[12px]" style={{ color: "var(--st-critical-ink)" }}>
            {error}
          </p>
        ) : analysis ? (
          <>
            <p className="text-[13px] leading-relaxed">{analysis.sentence}</p>
            <table className="w-full text-left border-collapse text-[12px] mt-4">
              <thead>
                <tr className="txt-3 text-[10.5px] uppercase tracking-wider">
                  <th scope="col" className="py-1.5 pr-3 font-semibold">
                    Region
                  </th>
                  <th scope="col" className="py-1.5 pr-3 font-semibold text-right">
                    Amplitude
                  </th>
                  <th scope="col" className="py-1.5 pr-3 font-semibold text-right">
                    App Intel
                  </th>
                  <th scope="col" className="py-1.5 font-semibold text-right">
                    Diff
                  </th>
                </tr>
              </thead>
              <tbody>
                {analysis.regions.map((region) => {
                  const tone = diffTone(region.diff, tolerance);
                  return (
                    <tr key={region.ampEnv} className="border-t" style={{ borderColor: "var(--grid)" }}>
                      <td className="py-1 pr-3">
                        {region.ampEnv} / {region.aiEnv}
                      </td>
                      <td className="py-1 pr-3 text-right tabular-nums">{countText(region.amp)}</td>
                      <td className="py-1 pr-3 text-right tabular-nums">{countText(region.ai)}</td>
                      <td
                        className="py-1 text-right tabular-nums"
                        style={tone ? { color: DIFF_INK[tone] } : undefined}
                      >
                        {region.diff == null ? "—" : `${region.diff}%`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </>
        ) : (
          <p className="txt-2 text-[12px]">Analyzing…</p>
        )}
      </div>
    </>
  );
}
