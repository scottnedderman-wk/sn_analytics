import { appHref, fmt, sparklinePath, topLiveByVolume, type RepoRecord } from "./model";
import { Highlight, InternalLink } from "./ui";

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

export function AppSummary({ repo, query }: { repo: RepoRecord; query: string }) {
  const live = topLiveByVolume(repo.events, 5);
  const showSpark = live.some((e) => (e.series30?.length ?? 0) >= 2);
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
            <tr className="txt-3 text-[10.5px] uppercase tracking-wider">
              <th scope="col" className="py-1.5 pr-3 font-semibold">
                Event
              </th>
              {showSpark ? (
                <th scope="col" className="py-1.5 pr-2 font-semibold text-right whitespace-nowrap w-[1%]">
                  Last 30d
                </th>
              ) : null}
              <th scope="col" className="py-1.5 font-semibold text-right whitespace-nowrap w-[1%]">
                30d vol
              </th>
            </tr>
          </thead>
          <tbody>
            {live.map((ev) => (
              <tr key={`${ev.name}|${ev.legacy.join(",")}`} className="border-t" style={{ borderColor: "var(--grid)" }}>
                <td className="py-1.5 pr-3 align-middle">
                  <span className="font-medium">
                    <Highlight text={ev.name} query={query} />
                  </span>
                </td>
                {showSpark ? (
                  <td className="py-1.5 pr-2 align-middle text-right w-[1%]">
                    {ev.series30 && ev.series30.length >= 2 ? (
                      <span className="inline-flex justify-end">
                        <Sparkline values={ev.series30} />
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                ) : null}
                <td className="py-1.5 align-middle text-right tabular-nums whitespace-nowrap w-[1%]">{fmt(ev.v30)}</td>
              </tr>
            ))}
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
