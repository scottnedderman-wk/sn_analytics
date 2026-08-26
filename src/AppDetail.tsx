import { useEffect, useState, type MouseEvent, type ReactNode } from "react";
import {
  compareRowFromContract,
  contractFor,
  contractsForRepo,
  formatScoreTitle,
  type CompareRow,
} from "./eventCompare";
import { EventCompareModal } from "./EventCompareModal";
import {
  fmt,
  githubRepoUrl,
  isTemplateName,
  pctColor,
  repoCompletion,
  sortEvents,
  type MigrationEvent,
  type RepoRecord,
} from "./model";
import { Badge, Highlight, InternalLink, MagnifyIcon, Meter, RefreshIcon, UnassessableNote } from "./ui";

async function postRefresh(url: string): Promise<CompareRow[]> {
  const res = await fetch(url, { method: "POST" });
  const body = (await res.json()) as { rows?: CompareRow[]; error?: string };
  if (!res.ok) throw new Error(body.error ?? res.statusText);
  return body.rows ?? [];
}

function overlayFor(cache: Record<string, CompareRow>, name: string): CompareRow | null {
  return cache[name] ?? compareRowFromContract(name);
}

export function mergeRows(prev: Record<string, CompareRow>, rows: CompareRow[]): Record<string, CompareRow> {
  const next = { ...prev };
  for (const row of rows) next[row.eventName] = row;
  return next;
}

function pendingCompareRow(eventName: string): CompareRow {
  return (
    compareRowFromContract(eventName) ?? {
      eventName,
      snapshot: null,
      refreshedAt: null,
      lastError: null,
      parts: { present: null, type: null, populated: null, volume: null },
      match: null,
    }
  );
}

export function isRefreshBusy(busy: Set<string>, name: string): boolean {
  return busy.has("*") || busy.has(name);
}

export function isRefreshAllDisabled(repo: string, anyBusy: boolean): boolean {
  return anyBusy || contractsForRepo(repo).length === 0;
}

function iconBtnClass(disabled: boolean): string {
  return `inline-flex items-center justify-center rounded p-1 ${disabled ? "opacity-40" : "hover:opacity-70"}`;
}

export function EventRow({
  ev,
  query,
  row,
  busy,
  onRefresh,
  onInspect,
}: {
  ev: MigrationEvent;
  query: string;
  row: CompareRow | null;
  busy: Set<string>;
  onRefresh: () => void;
  onInspect: () => void;
}) {
  const legacy = ev.legacy.length ? ev.legacy.join(", ") : "—";
  const vol = ev.v30 > 0 ? fmt(ev.v30) : ev.dev30 > 0 ? `${fmt(ev.dev30)} (dev)` : "—";
  const tmpl = isTemplateName(ev.name, ev.legacy);
  const usage =
    ev.queried > 0 ? (
      <span className="txt-3" title="Times queried in charts/dashboards in the last year">
        {ev.queried} {ev.queried === 1 ? "query" : "queries"}
      </span>
    ) : (
      "—"
    );
  let github: ReactNode = "—";
  if (ev.merged || ev.pr) {
    github = (
      <>
        {ev.merged ? (
          <span className="txt-3 text-[10.5px]" title="Migration PR merged" aria-label="merged">
            ✅
          </span>
        ) : null}
        {ev.merged && ev.pr ? " " : null}
        {ev.pr ? (
          <a
            href={ev.pr}
            target="_blank"
            rel="noopener"
            className="underline decoration-dotted hover:opacity-70"
            style={{ color: "var(--text-secondary)" }}
          >
            PR
          </a>
        ) : null}
      </>
    );
  }
  const contracted = !!contractFor(ev.name);
  const refreshDisabled = !contracted || isRefreshBusy(busy, ev.name);
  return (
    <tr className="border-t" style={{ borderColor: "var(--grid)" }}>
      <td className="py-1.5 pr-3 align-top">
        <span className="font-medium">
          <Highlight text={ev.name} query={query} />
        </span>
        {tmpl ? (
          <span
            className="txt-3 text-[10.5px] ml-1"
            title="Name contains a runtime placeholder, so it cannot be matched to Amplitude by exact string. Status is not meaningful for this row."
          >
            template
          </span>
        ) : null}
      </td>
      <td className="py-1.5 pr-3 align-top txt-3 font-mono text-[11px] break-all">
        <Highlight text={legacy} query={query} />
      </td>
      <td className="py-1.5 pr-3 align-top">
        <Badge status={ev.status} />
      </td>
      <td className="py-1.5 pr-3 align-top text-right tabular-nums whitespace-nowrap">{vol}</td>
      <td className="py-1.5 pr-3 align-top text-right whitespace-nowrap text-[11px]">{usage}</td>
      <td className="py-1.5 pr-3 align-top text-right whitespace-nowrap text-[11px]">{github}</td>
      <td className="py-1.5 pr-3 align-top text-right tabular-nums whitespace-nowrap text-[11px]">
        {row?.match == null ? (
          "—"
        ) : (
          <span style={{ color: pctColor(row.match) }} title={formatScoreTitle(row.parts)}>
            {row.match}%
          </span>
        )}
      </td>
      <td className="py-1.5 pr-3 align-top text-right whitespace-nowrap">
        <button
          type="button"
          className={iconBtnClass(refreshDisabled)}
          disabled={refreshDisabled}
          aria-label={`Refresh comparison for ${ev.name}`}
          onClick={onRefresh}
        >
          <RefreshIcon />
        </button>
      </td>
      <td className="py-1.5 align-top text-right whitespace-nowrap">
        <button
          type="button"
          className={iconBtnClass(false)}
          aria-label={`Inspect ${ev.name}`}
          onClick={onInspect}
        >
          <MagnifyIcon />
        </button>
      </td>
    </tr>
  );
}

function EventTable({
  repo,
  events,
  query,
  cache,
  busy,
  onRefresh,
  onInspect,
}: {
  repo: RepoRecord;
  events: MigrationEvent[];
  query: string;
  cache: Record<string, CompareRow>;
  busy: Set<string>;
  onRefresh: (ev: MigrationEvent) => void;
  onInspect: (ev: MigrationEvent) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left border-collapse">
        <caption className="sr-only">Migrated events for {repo.repo}</caption>
        <thead>
          <tr className="txt-3 text-[10.5px] uppercase tracking-wider">
            <th scope="col" className="py-1.5 pr-3 font-semibold">
              New (Amplitude) event
            </th>
            <th scope="col" className="py-1.5 pr-3 font-semibold">
              Legacy name
            </th>
            <th scope="col" className="py-1.5 pr-3 font-semibold">
              Status
            </th>
            <th scope="col" className="py-1.5 pr-3 font-semibold text-right">
              30d volume
            </th>
            <th scope="col" className="py-1.5 pr-3 font-semibold text-right">
              Usage
            </th>
            <th scope="col" className="py-1.5 pr-3 font-semibold text-right">
              GitHub
            </th>
            <th scope="col" className="py-1.5 pr-3 font-semibold text-right">
              Match
            </th>
            <th scope="col" className="py-1.5 pr-3 font-semibold text-right">
              <span className="sr-only">Refresh</span>
            </th>
            <th scope="col" className="py-1.5 font-semibold text-right">
              <span className="sr-only">Inspect</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {events.map((e) => (
            <EventRow
              key={`${e.name}|${e.legacy.join(",")}`}
              ev={e}
              query={query}
              row={overlayFor(cache, e.name)}
              busy={busy}
              onRefresh={() => onRefresh(e)}
              onInspect={() => onInspect(e)}
            />
          ))}
        </tbody>
      </table>
      {events.length < repo.total ? (
        <p className="txt-3 text-[11px] mt-2">
          Showing {events.length} of {repo.total} events (filtered).
        </p>
      ) : null}
    </div>
  );
}

export function AppDetail({
  repo: r,
  onTip,
}: {
  repo: RepoRecord;
  onTip: (text: string | null, e?: MouseEvent) => void;
}) {
  const { live, scored, pct, unassessable } = repoCompletion(r);
  const events = sortEvents(r.events, "volume");
  const [cache, setCache] = useState<Record<string, CompareRow>>({});
  const [busy, setBusy] = useState<Set<string>>(() => new Set());
  const [inspecting, setInspecting] = useState<MigrationEvent | null>(null);
  const [clientError, setClientError] = useState<string | null>(null);

  useEffect(() => {
    setCache({});
    setBusy(new Set());
    setInspecting(null);
    setClientError(null);
    let cancelled = false;
    fetch(`/api/compare/${encodeURIComponent(r.repo)}`)
      .then((res) => res.json() as Promise<{ rows?: CompareRow[] }>)
      .then((body) => {
        if (cancelled) return;
        const next: Record<string, CompareRow> = {};
        for (const row of body.rows ?? []) next[row.eventName] = row;
        setCache(next);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [r.repo]);

  const overlayRows = events
    .map((ev) => overlayFor(cache, ev.name))
    .filter((row): row is CompareRow => row != null);
  const lastRefreshedAt = overlayRows.reduce<string | null>((best, row) => {
    if (!row.refreshedAt) return best;
    if (!best || row.refreshedAt > best) return row.refreshedAt;
    return best;
  }, null);
  const headerError = overlayRows.find((row) => row.lastError)?.lastError ?? null;
  const displayError = clientError ?? headerError;
  const anyBusy = busy.size > 0;
  const refreshAllDisabled = isRefreshAllDisabled(r.repo, anyBusy);

  async function refreshAll() {
    setBusy(new Set(["*"]));
    try {
      const rows = await postRefresh(`/api/compare/${encodeURIComponent(r.repo)}/refresh`);
      setCache((prev) => mergeRows(prev, rows));
      setClientError(null);
    } catch (err) {
      setClientError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(new Set());
    }
  }

  async function refreshEvent(ev: MigrationEvent) {
    setBusy((prev) => new Set(prev).add(ev.name));
    try {
      const rows = await postRefresh(
        `/api/compare/${encodeURIComponent(r.repo)}/events/${encodeURIComponent(ev.name)}/refresh`,
      );
      setCache((prev) => mergeRows(prev, rows));
      setClientError(null);
    } catch (err) {
      setClientError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy((prev) => {
        const next = new Set(prev);
        next.delete(ev.name);
        return next;
      });
    }
  }

  return (
    <div>
      <p className="mb-4">
        <InternalLink href="/" className="txt-2 text-[12px] underline decoration-dotted hover:opacity-70">
          ← All applications
        </InternalLink>
      </p>
      <header className="flex items-start justify-between gap-4 mb-4">
        <div className="min-w-0 flex-1">
          <h1 className="text-[21px] font-bold tracking-tight">{r.repo}</h1>
          <p className="mt-1">
            <a
              href={githubRepoUrl(r.repo)}
              target="_blank"
              rel="noopener"
              className="text-[12px] underline decoration-dotted hover:opacity-70"
              style={{ color: "var(--text-secondary)" }}
            >
              GitHub ↗
            </a>
          </p>
          <div className="mt-3 max-w-md">
            <Meter counts={r.counts} total={r.total} onTip={onTip} />
          </div>
        </div>
        <div className="shrink-0 text-right">
          {unassessable ? (
            <span className="txt-3 text-[12px]">no mapping source</span>
          ) : pct === null ? (
            <span className="txt-3 text-[12px]">no live/not-seen</span>
          ) : (
            <>
              <span className="block text-[22px] font-bold tabular-nums" style={{ color: pctColor(pct) }}>
                {pct}%
              </span>
              <span className="block txt-3 text-[11px]">
                {live}/{scored} live
              </span>
              <span className="block text-[12.5px] tabular-nums font-medium mt-1">
                {r.volume30 ? fmt(r.volume30) : "—"}{" "}
                <span className="txt-3 text-[10.5px] font-normal">30d events</span>
              </span>
            </>
          )}
          {!unassessable ? (
            <div className="mt-3">
              <button
                type="button"
                className="surf border rounded-md px-2.5 py-1.5 text-[12px] font-medium hover:opacity-80 disabled:opacity-40"
                disabled={refreshAllDisabled}
                aria-busy={anyBusy}
                onClick={() => void refreshAll()}
              >
                Refresh all
              </button>
              <span className="block txt-3 text-[11px] mt-1">
                Last refreshed {lastRefreshedAt ? new Date(lastRefreshedAt).toLocaleString() : "Never"}
              </span>
              {displayError ? (
                <span className="block text-[11px] mt-0.5" style={{ color: "var(--st-critical-ink)" }}>
                  {displayError}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      </header>
      <section className="surf border rounded-lg px-4 py-3">
        {unassessable ? (
          <UnassessableNote />
        ) : (
          <EventTable
            repo={r}
            events={events}
            query=""
            cache={cache}
            busy={busy}
            onRefresh={(ev) => void refreshEvent(ev)}
            onInspect={setInspecting}
          />
        )}
      </section>
      {inspecting ? (
        <EventCompareModal
          row={overlayFor(cache, inspecting.name) ?? pendingCompareRow(inspecting.name)}
          legacy={inspecting.legacy}
          onClose={() => setInspecting(null)}
        />
      ) : null}
    </div>
  );
}
