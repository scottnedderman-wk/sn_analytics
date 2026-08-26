import { useEffect, useRef } from "react";
import {
  contractFor,
  formatScoreTitle,
  type CompareRow,
  type ContractField,
  type SnapshotField,
} from "./eventCompare";
import { pctColor } from "./model";

function scoreChip(n: number | null): string {
  return n == null ? "pending" : `${n}%`;
}

function volumeText(n: number | null | undefined): string {
  return n == null ? "pending" : n.toLocaleString();
}

function fillPct(n: number | null): string | null {
  return n == null ? null : `${Math.round(n * 100)}%`;
}

function populatedCell(aiFill: number | null, ampFill: number | null): string {
  const ai = fillPct(aiFill);
  const amp = fillPct(ampFill);
  if (ai == null || amp == null) return "pending";
  return `${ai}/${amp}`;
}

type FieldView = {
  label: string;
  aiColumn: string;
  aiType: string;
  ampColumn: string;
  ampType: string;
  present: boolean;
  typeCompatible: boolean;
  aiFill: number | null;
  ampFill: number | null;
};

function comparableFields(row: CompareRow): FieldView[] {
  const contract = contractFor(row.eventName);
  if (row.snapshot?.fields.length) {
    return row.snapshot.fields.map((f: SnapshotField) => ({
      label: contract?.fields.find((c) => c.key === f.key)?.label ?? f.key,
      aiColumn: f.aiColumn,
      aiType: f.aiType,
      ampColumn: f.ampColumn,
      ampType: f.ampType,
      present: f.present,
      typeCompatible: f.typeCompatible,
      aiFill: f.aiFill,
      ampFill: f.ampFill,
    }));
  }
  return (contract?.fields ?? []).map((f: ContractField) => ({
    label: f.label,
    aiColumn: f.aiColumn,
    aiType: f.aiType,
    ampColumn: f.ampColumn,
    ampType: f.ampType,
    present: f.present,
    typeCompatible: f.typeCompatible,
    aiFill: null,
    ampFill: null,
  }));
}

export function EventCompareModal({
  row,
  legacy,
  onClose,
}: {
  row: CompareRow;
  legacy: string[];
  onClose: () => void;
}): JSX.Element {
  const dialogRef = useRef<HTMLDivElement>(null);
  const headingId = "event-compare-title";
  const contract = contractFor(row.eventName);
  const fields = comparableFields(row);
  const aiVolume = row.snapshot?.volume.ai;
  const ampVolume = row.snapshot?.volume.amp;
  const subtitle = legacy.length ? legacy.join(", ") : "—";

  useEffect(() => {
    dialogRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

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
        className="surf border rounded-lg fixed z-50 inset-x-4 top-8 mx-auto max-w-3xl max-h-[calc(100vh-4rem)] overflow-y-auto p-5 outline-none"
        style={{ background: "var(--surface-1)", borderColor: "var(--border)" }}
      >
        <header className="flex items-start justify-between gap-3 mb-4">
          <div className="min-w-0">
            <h2 id={headingId} className="text-[18px] font-bold tracking-tight">
              {row.eventName}
            </h2>
            <p className="txt-3 font-mono text-[11px] mt-1 break-all">{subtitle}</p>
          </div>
          <div className="shrink-0 text-right">
            {row.match == null ? (
              <span className="txt-3 text-[18px] font-bold">—</span>
            ) : (
              <span
                className="block text-[18px] font-bold tabular-nums"
                style={{ color: pctColor(row.match) }}
                title={formatScoreTitle(row.parts)}
              >
                {row.match}%
              </span>
            )}
            <button
              type="button"
              className="surf border rounded-md px-2.5 py-1 text-[12px] font-medium mt-2 hover:opacity-80"
              onClick={onClose}
            >
              Close
            </button>
          </div>
        </header>

        {row.lastError ? (
          <p className="txt-2 text-[12px] mb-3" style={{ color: "var(--st-critical-ink)" }}>
            {row.lastError}
          </p>
        ) : null}

        <ul className="flex flex-wrap gap-2 mb-4">
          {(
            [
              ["Present", row.parts.present],
              ["Type/format", row.parts.type],
              ["Populated", row.parts.populated],
              ["Volume", row.parts.volume],
            ] as const
          ).map(([label, value]) => (
            <li
              key={label}
              className="border rounded-md px-2 py-1 text-[11px]"
              style={{ borderColor: "var(--border)", background: "var(--surface-1)" }}
            >
              <span className="txt-3">{label}</span>{" "}
              <span className="font-medium tabular-nums">{scoreChip(value)}</span>
            </li>
          ))}
        </ul>

        <section className="mb-4">
          <h3 className="text-[10.5px] font-bold uppercase tracking-wider txt-3 mb-2">Volume</h3>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-[12px]">
            <dt className="txt-3">App Intel</dt>
            <dd className="tabular-nums text-right">{volumeText(aiVolume)}</dd>
            <dt className="txt-3">Amplitude</dt>
            <dd className="tabular-nums text-right">{volumeText(ampVolume)}</dd>
            {row.snapshot ? (
              <>
                <dt className="txt-3">Window</dt>
                <dd className="tabular-nums text-right">
                  {row.snapshot.window.start} – {row.snapshot.window.end}
                </dd>
              </>
            ) : null}
            <dt className="txt-3">Last refreshed</dt>
            <dd className="text-right">{row.refreshedAt ? new Date(row.refreshedAt).toLocaleString() : "Never"}</dd>
          </dl>
        </section>

        <section className="mb-4 overflow-x-auto">
          <h3 className="text-[10.5px] font-bold uppercase tracking-wider txt-3 mb-2">Comparable fields</h3>
          <table className="w-full text-left border-collapse text-[12px]">
            <thead>
              <tr className="txt-3 text-[10.5px] uppercase tracking-wider">
                <th scope="col" className="py-1.5 pr-3 font-semibold">
                  Field
                </th>
                <th scope="col" className="py-1.5 pr-3 font-semibold">
                  App Intel
                </th>
                <th scope="col" className="py-1.5 pr-3 font-semibold">
                  Amplitude
                </th>
                <th scope="col" className="py-1.5 pr-3 font-semibold">
                  Present
                </th>
                <th scope="col" className="py-1.5 pr-3 font-semibold">
                  Type/format
                </th>
                <th scope="col" className="py-1.5 font-semibold">
                  Populated
                </th>
              </tr>
            </thead>
            <tbody>
              {fields.map((f) => (
                <tr key={f.label} className="border-t" style={{ borderColor: "var(--grid)" }}>
                  <td className="py-1.5 pr-3 align-top font-medium">{f.label}</td>
                  <td className="py-1.5 pr-3 align-top font-mono text-[11px] txt-2">
                    {f.aiColumn} {f.aiType}
                  </td>
                  <td className="py-1.5 pr-3 align-top font-mono text-[11px] txt-2">
                    {f.ampColumn} {f.ampType}
                  </td>
                  <td className="py-1.5 pr-3 align-top">{f.present ? "yes" : "no"}</td>
                  <td className="py-1.5 pr-3 align-top">{f.typeCompatible ? "yes" : "no"}</td>
                  <td className="py-1.5 align-top tabular-nums">{populatedCell(f.aiFill, f.ampFill)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <details className="border rounded-md px-3 py-2" style={{ borderColor: "var(--border)" }}>
          <summary className="text-[12px] font-medium">Not compared</summary>
          {contract?.omitted.length ? (
            <ul className="mt-2 space-y-2">
              {contract.omitted.map((o) => (
                <li key={o.name} className="txt-2 text-[12px]">
                  <span className="font-medium">{o.name}</span>
                  <span className="txt-3"> — {o.reason}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="txt-3 text-[12px] mt-2">Nothing omitted.</p>
          )}
        </details>
      </div>
    </>
  );
}
