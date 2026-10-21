import { useEffect, useRef, useState } from "react";
import { DIFF_INK, ampAiDiffPct, diffTone } from "@/routes/dashboard/AppSummary";
import { exampleFieldRows, type EventSample } from "@/lib/eventSample";
import { eventVolumeSeries, type EventDayVolume } from "@/lib/eventVolumeCache";
import type { MigrationEvent } from "@/lib/model";
import type { DayWindow } from "@/lib/volumeWindow";

function countText(n: number | null): string {
  return n == null ? "—" : n.toLocaleString("en-US");
}

function sampleCaption(sample: EventSample): string {
  if (sample.paired) return "Same event in Amplitude and App Intel.";
  if (sample.amp && sample.ai) return "One example from each system in this window.";
  if (sample.amp) return "Amplitude example from this window.";
  if (sample.ai) return "App Intel example from this window.";
  return "No events in this window.";
}

function DiffValue({ amp, ai, tolerance }: { amp: number; ai: number | null; tolerance: number }) {
  const diff = ampAiDiffPct(amp, ai);
  const tone = diffTone(diff, tolerance);
  return (
    <span className="tabular-nums" style={tone ? { color: DIFF_INK[tone] } : undefined}>
      {diff == null ? "—" : `${diff}%`}
    </span>
  );
}

export function EventCompareModal({
  event,
  repo,
  applied,
  tolerance,
  days,
  sample: sampleProp,
  onClose,
}: {
  event: MigrationEvent;
  repo: string;
  applied: DayWindow | null;
  tolerance: number;
  days?: EventDayVolume[];
  sample?: EventSample | null;
  onClose: () => void;
}): JSX.Element {
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const headingId = "event-compare-title";
  const [loaded, setLoaded] = useState<EventDayVolume[] | null>(days ?? null);
  const [error, setError] = useState<string | null>(null);
  const [sample, setSample] = useState<EventSample | null>(sampleProp ?? null);
  const [sampleError, setSampleError] = useState<string | null>(null);
  const subtitle = event.legacy.length ? event.legacy.join(", ") : "—";
  const series = days ?? loaded;
  const ampTotal = series?.reduce((sum, day) => sum + day.amp, 0) ?? 0;
  const aiTotal = event.ai30 == null || !series ? null : series.reduce((sum, day) => sum + (day.ai ?? 0), 0);

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
    if (days || !applied) return;
    let cancelled = false;
    setLoaded(null);
    setError(null);
    const params = new URLSearchParams({ start: applied.start, end: applied.end });
    fetch(`/api/repos/${encodeURIComponent(repo)}/events/${encodeURIComponent(event.name)}/volume?${params}`)
      .then(async (res) => {
        const body = (await res.json()) as { rows?: Array<{ source: "amp" | "ai"; day: string; count: number }>; error?: string };
        if (!res.ok) throw new Error(body.error ?? res.statusText);
        return body.rows ?? [];
      })
      .then((rows) => {
        if (!cancelled) setLoaded(eventVolumeSeries(applied, rows, event.ai30 != null));
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [days, applied, repo, event.name, event.ai30]);

  useEffect(() => {
    if (sampleProp !== undefined || !applied) return;
    let cancelled = false;
    setSample(null);
    setSampleError(null);
    const params = new URLSearchParams({ start: applied.start, end: applied.end });
    fetch(`/api/repos/${encodeURIComponent(repo)}/events/${encodeURIComponent(event.name)}/sample?${params}`)
      .then(async (res) => {
        const body = (await res.json()) as EventSample & { error?: string };
        if (!res.ok) throw new Error(body.error ?? res.statusText);
        return body;
      })
      .then((body) => {
        if (!cancelled) setSample(body);
      })
      .catch((err) => {
        if (!cancelled) setSampleError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [sampleProp, applied, repo, event.name]);

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
        aria-labelledby={headingId}
        tabIndex={-1}
        className="surf border rounded-lg fixed z-50 inset-x-4 top-8 mx-auto w-[80vw] max-h-[calc(100vh-4rem)] overflow-y-auto p-5 outline-none"
        style={{ background: "var(--surface-1)", borderColor: "var(--border)" }}
      >
        <header className="flex items-start justify-between gap-3 mb-4">
          <div className="min-w-0">
            <h2 id={headingId} className="text-[18px] font-bold tracking-tight">
              {event.name}
            </h2>
            <p className="txt-3 font-mono text-[11px] mt-1 break-all">{subtitle}</p>
            {applied ? (
              <p className="txt-2 text-[12px] mt-2 tabular-nums">{`${applied.start} – ${applied.end}`}</p>
            ) : (
              <p className="txt-2 text-[12px] mt-2">Apply a date window to load this event.</p>
            )}
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
          <p className="text-[12px] mb-3" style={{ color: "var(--st-critical-ink)" }}>
            {error}
          </p>
        ) : null}

        {applied && series ? (
          <>
            <dl className="grid grid-cols-3 gap-3 mb-4 text-[12px]">
              <div>
                <dt className="txt-3">Amplitude</dt>
                <dd className="text-[15px] font-medium tabular-nums">{countText(ampTotal)}</dd>
              </div>
              <div>
                <dt className="txt-3">App Intel</dt>
                <dd className="text-[15px] font-medium tabular-nums">{countText(aiTotal)}</dd>
              </div>
              <div>
                <dt className="txt-3">Diff</dt>
                <dd className="text-[15px] font-medium">
                  <DiffValue amp={ampTotal} ai={aiTotal} tolerance={tolerance} />
                </dd>
              </div>
            </dl>
            <table className="w-full text-left border-collapse text-[12px]">
              <thead>
                <tr className="txt-3 text-[10.5px] uppercase tracking-wider">
                  <th scope="col" className="py-1.5 pr-3 font-semibold">
                    Day
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
                {series.map((day) => (
                  <tr key={day.date} className="border-t" style={{ borderColor: "var(--grid)" }}>
                    <td className="py-1 pr-3 tabular-nums">{day.date}</td>
                    <td className="py-1 pr-3 text-right tabular-nums">{countText(day.amp)}</td>
                    <td className="py-1 pr-3 text-right tabular-nums">{countText(day.ai)}</td>
                    <td className="py-1 text-right">
                      <DiffValue amp={day.amp} ai={day.ai} tolerance={tolerance} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <section className="mt-5">
              <h3 className="text-[13px] font-semibold">Example</h3>
              {sampleError ? (
                <p className="text-[12px] mt-2" style={{ color: "var(--st-critical-ink)" }}>
                  {sampleError}
                </p>
              ) : sample ? (
                <>
                  <p className="txt-2 text-[12px] mt-1">{sampleCaption(sample)}</p>
                  <table className="w-full text-left border-collapse text-[12px] mt-2">
                    <thead>
                      <tr className="txt-3 text-[10.5px] uppercase tracking-wider">
                        <th scope="col" className="py-1.5 pr-3 font-semibold">
                          Field
                        </th>
                        <th scope="col" className="py-1.5 pr-3 font-semibold">
                          Amplitude
                        </th>
                        <th scope="col" className="py-1.5 font-semibold">
                          App Intel
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {exampleFieldRows(sample).map((field) => (
                        <tr key={field.key} className="border-t" style={{ borderColor: "var(--grid)" }}>
                          <th scope="row" className="py-1 pr-3 font-medium text-left">
                            {field.label}
                          </th>
                          <td className="py-1 pr-3 break-all">{field.amp ?? "—"}</td>
                          <td className="py-1 break-all">{field.ai ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              ) : (
                <p className="txt-2 text-[12px] mt-1">Loading example…</p>
              )}
            </section>
          </>
        ) : null}
      </div>
    </>
  );
}
