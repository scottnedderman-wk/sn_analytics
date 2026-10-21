import { Highlight, InternalLink } from "@/components/ui";
import { appHref, fmt, sparklinePath, topLiveByVolume, type RepoRecord } from "@/lib/model";

function Sparkline({ values }: { values: number[] }) {
  const width = 72;
  const height = 22;
  const d = sparklinePath(values, width, height);
  if (!d) return null;
  return (
    <svg
      width={width}
      height={height}
      viewBox={`-1 -1 ${width + 2} ${height + 2}`}
      className="sparkline"
      aria-hidden="true"
    >
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export function ampAiDiffPct(amp: number, ai: number | null | undefined): number | null {
  if (ai == null || amp === 0) return null;
  return Math.round((100 * (amp - ai)) / amp);
}

export function diffTone(diff: number | null, tolerance: number): "within" | "outside" | null {
  if (diff == null) return null;
  return Math.abs(diff) <= tolerance ? "within" : "outside";
}

export const DIFF_INK = {
  within: "var(--st-good-ink)",
  outside: "var(--st-critical-ink)",
} as const;

function SparkCell({ values }: { values?: number[] }) {
  return (
    <td className="py-1.5 pr-2 align-middle text-right w-[1%]">
      {values && values.length >= 2 ? (
        <span className="inline-flex justify-end">
          <Sparkline values={values} />
        </span>
      ) : (
        "—"
      )}
    </td>
  );
}

export function AppSummary({
  repo,
  query,
  tolerance,
}: {
  repo: RepoRecord;
  query: string;
  tolerance: number;
}) {
  const live = topLiveByVolume(repo.events, 5);
  const showSpark = live.some(
    (e) => (e.series30?.length ?? 0) >= 2 || (e.aiSeries30?.length ?? 0) >= 2,
  );
  if (!live.length) {
    return <p className="txt-2 text-[12px]">No live events in the last 30 days.</p>;
  }
  return (
    <div>
      <p className="txt-3 text-[11px] mb-2">Top {live.length} live by volume</p>
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <caption className="sr-only">Top live events for {repo.repo}</caption>
          <thead>
            <tr>
              <th scope="col" className="py-1.5 pr-8 font-semibold">
                Event
              </th>
              <th colSpan={showSpark ? 2 : 1} scope="colgroup" className="py-1.5 pr-10 font-semibold text-center">
                Amplitude
              </th>
              <th colSpan={showSpark ? 2 : 1} scope="colgroup" className="py-1.5 pr-10 font-semibold text-center">
                App Intel
              </th>
              <th scope="col" className="py-1.5 pl-6 font-semibold text-right">
                Diff
              </th>
            </tr>
          </thead>
          <tbody>
            {live.map((ev) => {
              const diff = ampAiDiffPct(ev.v30, ev.ai30);
              const tone = diffTone(diff, tolerance);
              return (
                <tr key={`${ev.name}|${ev.legacy.join(",")}`} className="border-t" style={{ borderColor: "var(--grid)" }}>
                <td className="py-1.5 pr-8 align-middle">
                  <span className="font-medium">
                    <Highlight text={ev.name} query={query} />
                  </span>
                </td>
                {showSpark ? <SparkCell values={ev.series30} /> : null}
                <td className="py-1.5 pr-10 align-middle text-right tabular-nums whitespace-nowrap w-[1%]">{fmt(ev.v30)}</td>
                {showSpark ? <SparkCell values={ev.aiSeries30} /> : null}
                <td className="py-1.5 pr-10 align-middle text-right tabular-nums whitespace-nowrap w-[1%]">
                  {ev.ai30 == null ? "—" : fmt(ev.ai30)}
                </td>
                <td
                  className="py-1.5 pl-6 align-middle text-right tabular-nums whitespace-nowrap w-[1%]"
                  style={tone ? { color: DIFF_INK[tone] } : undefined}
                >
                  {diff == null ? "—" : `${diff}%`}
                </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {repo.counts.live && repo.counts.live > live.length ? (
        <p className="txt-3 text-[11px] mt-2">
          Showing {live.length} of {repo.counts.live} live events.{" "}
          <InternalLink href={appHref(repo.repo)} className="underline decoration-dotted hover:opacity-70">
            View all
          </InternalLink>
        </p>
      ) : null}
    </div>
  );
}
