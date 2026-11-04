import { useEffect, useRef, useState } from "react";
import { exampleFieldRows, type EventSample } from "@/lib/eventSample";
import type { MigrationEvent } from "@/lib/model";
import type { DayWindow } from "@/lib/volumeWindow";

function sampleCaption(sample: EventSample): string {
  if (sample.paired) return "Same event in Amplitude and App Intel.";
  if (sample.amp && sample.ai) return "One example from each system in this window.";
  if (sample.amp) return "Amplitude example from this window.";
  if (sample.ai) return "App Intel example from this window.";
  return "No events in this window.";
}

function valueTone(amp: string | null, ai: string | null, side: "amp" | "ai"): "same" | "different" | "only" | "empty" {
  const value = side === "amp" ? amp : ai;
  const other = side === "amp" ? ai : amp;
  if (value == null) return "empty";
  if (other == null) return "only";
  return value === other ? "same" : "different";
}

const VALUE_INK = {
  same: "var(--st-good-ink)",
  different: "var(--st-critical-ink)",
  only: "var(--text-primary)",
  empty: "var(--text-muted)",
} as const;

function ValueCell({
  amp,
  ai,
  side,
}: {
  amp: string | null;
  ai: string | null;
  side: "amp" | "ai";
}) {
  const tone = valueTone(amp, ai, side);
  const value = side === "amp" ? amp : ai;
  return (
    <td className="py-1.5 pr-3 align-top" style={{ color: VALUE_INK[tone], overflowWrap: "anywhere" }}>
      {value ?? "—"}
    </td>
  );
}

export function EventExampleModal({
  event,
  repo,
  applied,
  sample: sampleProp,
  onCached,
  onClose,
}: {
  event: MigrationEvent;
  repo: string;
  applied: DayWindow | null;
  sample?: EventSample | null;
  onCached?: () => void;
  onClose: () => void;
}): JSX.Element {
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const onCachedRef = useRef(onCached);
  onCachedRef.current = onCached;
  const headingId = "event-example-title";
  const [sample, setSample] = useState<EventSample | null>(sampleProp ?? null);
  const [error, setError] = useState<string | null>(null);
  const subtitle = event.legacy.length ? event.legacy : [];

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
    if (sampleProp !== undefined || !applied) return;
    let cancelled = false;
    setSample(null);
    setError(null);
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
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [sampleProp, applied, repo, event.name]);

  useEffect(() => {
    if (sample?.amp || sample?.ai) onCachedRef.current?.();
  }, [sample]);

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
        <header className="flex items-start justify-between gap-4 mb-5 pb-4 border-b" style={{ borderColor: "var(--border)" }}>
          <div className="min-w-0">
            <h2 id={headingId} className="text-[20px] font-bold tracking-tight">
              Example
            </h2>
            {applied ? (
              <p className="text-[13px] mt-1 tabular-nums" style={{ color: "var(--text-secondary)" }}>
                {`${applied.start} – ${applied.end}`}
              </p>
            ) : (
              <p className="text-[13px] mt-1" style={{ color: "var(--text-secondary)" }}>
                Apply a date window to load an example.
              </p>
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

        {applied ? (
          error ? (
            <p className="text-[13px]" style={{ color: "var(--st-critical-ink)" }}>
              {error}
            </p>
          ) : sample ? (
            <>
              <p className="text-[13px] mb-3" style={{ color: "var(--text-secondary)" }}>
                {sampleCaption(sample)}
              </p>
              <table className="w-full text-left border-collapse text-[13px]" style={{ tableLayout: "fixed" }}>
                <thead>
                  <tr className="align-bottom">
                    <th
                      scope="col"
                      className="py-2 pr-3 font-semibold text-[11px] uppercase tracking-wider w-[22%]"
                      style={{ background: "var(--surface-3)", color: "var(--text-secondary)" }}
                    >
                      Field
                    </th>
                    <th scope="col" className="py-2 pr-4 font-normal text-left">
                      <span className="block text-[11px] uppercase tracking-wider" style={{ color: "var(--text-secondary)" }}>
                        Amplitude
                      </span>
                      <span className="block text-[16px] font-semibold mt-1 leading-snug" style={{ color: "var(--text-primary)" }}>
                        {event.name}
                      </span>
                    </th>
                    <th scope="col" className="py-2 font-normal text-left">
                      <span className="block text-[11px] uppercase tracking-wider" style={{ color: "var(--text-secondary)" }}>
                        App Intel
                      </span>
                      {subtitle.length === 0 ? (
                        <span className="block text-[16px] font-semibold mt-1" style={{ color: "var(--text-muted)" }}>
                          —
                        </span>
                      ) : (
                        subtitle.map((name) => (
                          <span
                            key={name}
                            className="block text-[16px] font-semibold mt-1 leading-snug"
                            style={{ color: "var(--text-primary)", overflowWrap: "anywhere" }}
                          >
                            {name}
                          </span>
                        ))
                      )}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {exampleFieldRows(sample).map((field) => (
                    <tr key={field.key} className="border-t" style={{ borderColor: "var(--grid)" }}>
                      <th
                        scope="row"
                        className="py-1.5 pr-3 font-medium text-left align-top"
                        style={{ background: "var(--surface-3)", color: "var(--text-secondary)" }}
                      >
                        {field.label}
                      </th>
                      <ValueCell amp={field.amp} ai={field.ai} side="amp" />
                      <ValueCell amp={field.amp} ai={field.ai} side="ai" />
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : (
            <p className="text-[13px]" style={{ color: "var(--text-secondary)" }}>
              Loading example…
            </p>
          )
        ) : null}
      </div>
    </>
  );
}
