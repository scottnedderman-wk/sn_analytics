import { useEffect, useMemo, useState, type MouseEvent } from "react";
import { AppSummary } from "./AppSummary";
import {
  appHref,
  dashboardSummary,
  fmt,
  githubRepoUrl,
  pctColor,
  repoCompletion,
  visibleRepos,
  type DashboardData,
  type RepoRecord,
  type SortBy,
  type StatusFilter,
} from "./model";
import { Highlight, InternalLink, MagnifyIcon, Meter, ThemeToggle, UnassessableNote } from "./ui";

function RepoCard({
  repo: r,
  query,
  open,
  onToggle,
  onTip,
}: {
  repo: RepoRecord;
  query: string;
  open: boolean;
  onToggle: (open: boolean) => void;
  onTip: (text: string | null, e?: MouseEvent) => void;
}) {
  const { live, scored, pct, unassessable } = repoCompletion(r);
  const url = githubRepoUrl(r.repo);

  return (
    <details
      className="surf border rounded-lg"
      open={open}
      onToggle={(e) => onToggle((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary className="repo-summary flex items-center gap-3 px-4 py-3 hover:bg-black/[.02] rounded-lg">
        <span className="chev txt-3 shrink-0" aria-hidden="true">
          ▸
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2 flex-wrap">
            <span className="font-semibold text-[13.5px]">
              <Highlight text={r.repo} query={query} />
            </span>
            <a
              href={url}
              target="_blank"
              rel="noopener"
              onClick={(e) => e.stopPropagation()}
              className="text-[11.5px] underline decoration-dotted hover:opacity-70 shrink-0"
              style={{ color: "var(--text-secondary)" }}
              aria-label={`Open ${r.repo} on GitHub`}
            >
              GitHub ↗
            </a>
          </span>
          <span className="block mt-1.5 max-w-md">
            <Meter counts={r.counts} total={r.total} onTip={onTip} />
          </span>
        </span>
        <span className="shrink-0 text-right">
          {unassessable ? (
            <span className="txt-3 text-[11.5px]">no mapping source</span>
          ) : pct === null ? (
            <span className="txt-3 text-[11.5px]">no live/not-seen</span>
          ) : (
            <>
              <span className="block text-[15px] font-bold tabular-nums" style={{ color: pctColor(pct) }}>
                {pct}%
              </span>
              <span className="block txt-3 text-[11px]">
                {live}/{scored} live
              </span>
            </>
          )}
        </span>
        <span className="shrink-0 text-right w-20 hidden sm:block">
          <span className="block text-[12.5px] tabular-nums font-medium">{r.volume30 ? fmt(r.volume30) : "—"}</span>
          <span className="block txt-3 text-[10.5px]">30d events</span>
        </span>
        <span
          className="shrink-0 inline-flex"
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <InternalLink
            href={appHref(r.repo)}
            ariaLabel={`View ${r.repo} details`}
            className="hover:opacity-70 p-1.5 -mr-1.5 inline-flex items-center"
          >
            <MagnifyIcon size={24} />
          </InternalLink>
        </span>
      </summary>
      {unassessable ? (
        <div className="px-4 pb-4 pt-1">
          <UnassessableNote />
        </div>
      ) : (
        <div className="px-4 pb-4 pt-1">
          <AppSummary repo={r} query={query} />
        </div>
      )}
    </details>
  );
}

export function Dashboard({
  data,
  theme,
  onToggleTheme,
  onTip,
}: {
  data: DashboardData;
  theme: "light" | "dark";
  onToggleTheme: () => void;
  onTip: (text: string | null, e?: MouseEvent) => void;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [sortBy, setSortBy] = useState<SortBy>("volume");
  const [openRepos, setOpenRepos] = useState<Set<string>>(new Set());

  const shown = useMemo(() => visibleRepos(data.repos, query, filter, sortBy), [data, query, filter, sortBy]);
  const summary = useMemo(() => dashboardSummary(data.repos), [data]);
  const q = query.trim();
  const eventCount = shown.reduce((s, r) => s + r.events.length, 0);
  const filtered = Boolean(q) || filter !== "all";

  useEffect(() => {
    if (q || filter !== "all") {
      setOpenRepos(new Set(shown.map((s) => s.repo.repo)));
    }
  }, [q, filter, shown]);

  function setOpen(repo: string, next: boolean) {
    setOpenRepos((prev) => {
      const copy = new Set(prev);
      if (next) copy.add(repo);
      else copy.delete(repo);
      return copy;
    });
  }

  return (
    <>
      <header className="flex items-start justify-between gap-4 mb-1">
        <div>
          <h1 className="text-[21px] font-bold tracking-tight">Analytics Migration Status</h1>
          <p className="txt-2 text-[12.5px] mt-1">
            Legacy <code className="txt-3">user_analytics</code> → Amplitude · per application
          </p>
        </div>
        <ThemeToggle theme={theme} onToggle={onToggleTheme} />
      </header>
      <p className="txt-3 text-[11.5px] mb-6">{data.provenance}</p>

      <section aria-label="Summary" className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <div className="surf border rounded-lg px-4 py-3.5">
          <div className="txt-2 text-[11.5px] font-medium">Applications</div>
          <div className="text-[26px] font-bold leading-tight mt-0.5 tabular-nums">{summary.applications}</div>
          <div className="txt-3 text-[11px] mt-0.5">
            {summary.tracked} tracked, {summary.unassessable} unassessable
          </div>
        </div>
        <div className="surf border rounded-lg px-4 py-3.5">
          <div className="txt-2 text-[11.5px] font-medium">Mapped events</div>
          <div className="text-[26px] font-bold leading-tight mt-0.5 tabular-nums">{summary.mapped.toLocaleString()}</div>
          <div className="txt-3 text-[11px] mt-0.5">legacy → Amplitude pairs</div>
        </div>
        <div className="surf border rounded-lg px-4 py-3.5">
          <div className="txt-2 text-[11.5px] font-medium">Live in Amplitude</div>
          <div className="text-[26px] font-bold leading-tight mt-0.5 tabular-nums" style={{ color: pctColor(summary.pct) }}>
            {summary.pct}%
          </div>
          <div className="txt-3 text-[11px] mt-0.5">
            {summary.live.toLocaleString()} of {summary.scored.toLocaleString()} live vs not seen
          </div>
        </div>
        <div className="surf border rounded-lg px-4 py-3.5">
          <div className="txt-2 text-[11.5px] font-medium">Not yet flowing</div>
          <div
            className="text-[26px] font-bold leading-tight mt-0.5 tabular-nums"
            style={{ color: "var(--st-critical-ink)" }}
          >
            {summary.missing.toLocaleString()}
          </div>
          <div className="txt-3 text-[11px] mt-0.5">not seen (blocked &amp; dev-only excluded)</div>
        </div>
      </section>

      <section className="surf border rounded-lg px-4 py-3 mb-4">
        <h2 className="text-[10.5px] font-bold uppercase tracking-wider txt-3 mb-2">Status legend</h2>
        <div className="flex flex-wrap gap-x-5 gap-y-2 text-[12px]">
          <span className="flex items-center gap-1.5">
            <b style={{ color: "var(--st-good-ink)" }}>✓</b>
            <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: "var(--st-good)" }} />
            <b>Live</b> <span className="txt-3">— receiving events in Production (last 30d)</span>
          </span>
          <span className="flex items-center gap-1.5">
            <b style={{ color: "var(--st-warning-ink)" }}>△</b>
            <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: "var(--st-warning)" }} />
            <b>Stale</b> <span className="txt-3">— seen in past year, silent last 30d</span>
          </span>
          <span className="flex items-center gap-1.5">
            <b style={{ color: "var(--st-warning-ink)" }}>⚙</b>
            <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: "var(--st-warning)" }} />
            <b>Dev only</b> <span className="txt-3">— lower environments only</span>
          </span>
          <span className="flex items-center gap-1.5">
            <b style={{ color: "var(--st-serious-ink)" }}>⊘</b>
            <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: "var(--st-serious)" }} />
            <b>Blocked</b> <span className="txt-3">— deleted or blocked in Amplitude</span>
          </span>
          <span className="flex items-center gap-1.5">
            <b style={{ color: "var(--st-critical-ink)" }}>✗</b>
            <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: "var(--st-critical)" }} />
            <b>Not seen</b> <span className="txt-3">— mapped but never received</span>
          </span>
        </div>
        <h2 className="text-[10.5px] font-bold uppercase tracking-wider txt-3 mt-3.5 mb-2">Progress bar</h2>
        <div className="flex flex-wrap gap-x-5 gap-y-2 text-[12px]">
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: "var(--st-good)" }} /> Live
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: "var(--st-info)" }} /> Blocked or
            dev-only
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: "var(--st-warning)" }} /> Stale
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: "var(--st-critical)" }} /> Not seen
          </span>
          <span className="txt-3">Hover any segment for counts.</span>
        </div>
      </section>

      <section className="flex flex-wrap items-center justify-between gap-y-2 gap-x-3 mb-5 w-full">
        <input
          type="search"
          placeholder="Filter events or apps…"
          aria-label="Filter events or applications"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="surf border rounded-md px-3 py-1.5 text-[12.5px] w-52 shrink-0 outline-none focus:ring-2 focus:ring-blue-500/40"
        />
        <label className="flex items-center gap-1.5 text-[12px] txt-2">
          <span className="whitespace-nowrap">Filter status</span>
          <select
            aria-label="Filter by event status"
            value={filter}
            onChange={(e) => setFilter(e.target.value as StatusFilter)}
            className="surf border rounded-md px-2 py-1.5 text-[12px] font-medium outline-none focus:ring-2 focus:ring-blue-500/40"
          >
            <option value="all">All</option>
            <option value="live">Live</option>
            <option value="stale">Stale</option>
            <option value="dev_only">Dev</option>
            <option value="blocked">Blocked</option>
            <option value="missing">Not seen</option>
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-[12px] txt-2">
          <span className="whitespace-nowrap">Sort events</span>
          <select
            aria-label="Sort events within each application"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortBy)}
            className="surf border rounded-md px-2 py-1.5 text-[12px] font-medium outline-none focus:ring-2 focus:ring-blue-500/40"
          >
            <option value="name">Name</option>
            <option value="volume">Volume</option>
          </select>
        </label>
        <div className="flex gap-1.5">
          <button
            type="button"
            className="surf border rounded-md px-2.5 py-1.5 text-[12px] font-medium"
            onClick={() => setOpenRepos(new Set(shown.map((s) => s.repo.repo)))}
          >
            Expand all
          </button>
          <button
            type="button"
            className="surf border rounded-md px-2.5 py-1.5 text-[12px] font-medium"
            onClick={() => setOpenRepos(new Set())}
          >
            Collapse all
          </button>
        </div>
      </section>

      <p className="txt-3 text-[11.5px] mb-3" role="status" aria-live="polite">
        {shown.length} application{shown.length === 1 ? "" : "s"}
        {filtered ? ` · ${eventCount} matching event${eventCount === 1 ? "" : "s"}` : ""}
      </p>
      {shown.length === 0 ? (
        <p className="txt-2 text-center py-12">No applications or events match that filter.</p>
      ) : (
        <main className="flex flex-col gap-2.5">
          {shown.map(({ repo }) => (
            <RepoCard
              key={repo.repo}
              repo={repo}
              query={q}
              open={openRepos.has(repo.repo)}
              onToggle={(next) => setOpen(repo.repo, next)}
              onTip={onTip}
            />
          ))}
        </main>
      )}

      <footer className="mt-10 pt-5 border-t txt-3 text-[11.5px]" style={{ borderColor: "var(--border)" }}>
        <p className="mb-1">
          <b>How status is determined.</b> An event counts as <b>Live</b> when the migrated (Amplitude) event name
          appears with non-zero volume in the Production project in the last 30 days. Completion % (per app and
          headline) is <b>live / (live + not seen)</b>; blocked, stale, and dev-only events are excluded from that
          ratio. Volume comes from Amplitude Production, last {data.volumeWindowDays ?? 30} days
          {data.volumeAsOf ? (
            <>
              {" "}
              ending <code>{data.volumeAsOf}</code>
            </>
          ) : (
            <>
              {" "}
              (<code>2026-08-11</code> export)
            </>
          )}
          ; the mapping comes from the migration spreadsheet (Browser Burn List, Revised Browser Burn List, Mapping, and
          Script Results tabs) and from each repo's <code>ANALYTICS_MIGRATION_MAPPING.md</code> where present.
        </p>
        <p>
          <b>Known gaps.</b> Repos <code>app_intelligence_dart</code>, <code>wdesk_sdk_extensibility</code> appear in the
          inventory with no next-gen mapping rows (and no in-repo mapping doc), so they cannot be assessed. Matching is
          by exact event-name string, so a name that differs between spreadsheet and Amplitude reads as “Not seen” even
          if related traffic is flowing under another name. Combined next-gen names in the tracker (joined with{" "}
          <code>/</code>) are split into separate rows.
        </p>
      </footer>
    </>
  );
}
