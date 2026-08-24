import { type MouseEvent, type ReactNode } from "react";
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
import { Badge, Highlight, InternalLink, Meter, UnassessableNote } from "./ui";

function EventRow({ ev, query }: { ev: MigrationEvent; query: string }) {
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
      <td className="py-1.5 align-top text-right whitespace-nowrap text-[11px]">{github}</td>
    </tr>
  );
}

function EventTable({ repo, events, query }: { repo: RepoRecord; events: MigrationEvent[]; query: string }) {
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
            <th scope="col" className="py-1.5 font-semibold text-right">
              GitHub
            </th>
          </tr>
        </thead>
        <tbody>
          {events.map((e) => (
            <EventRow key={`${e.name}|${e.legacy.join(",")}`} ev={e} query={query} />
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
        </div>
      </header>
      <section className="surf border rounded-lg px-4 py-3">
        {unassessable ? <UnassessableNote /> : <EventTable repo={r} events={events} query="" />}
      </section>
    </div>
  );
}
