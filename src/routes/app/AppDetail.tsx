import { useEffect, useMemo, useState, type MouseEvent } from "react";
import { useVolumeWindow } from "@/app/VolumeWindowContext";
import { DIFF_INK, ampAiDiffPct, diffTone } from "@/routes/dashboard/AppSummary";
import { eventVolumeSeries } from "@/lib/eventVolumeCache";
import {
  explainCounts,
  explainEvent,
  explainSummary,
  groupRelatedEvents,
  reasonText,
  type DayVolume,
  type GroupBand,
  type ShareRole,
} from "@/lib/volumeExplain";
import type { RepoContributor } from "@/lib/repoContributors";
import {
  fmt,
  githubRepoUrl,
  isTemplateName,
  pctColor,
  repoCompletion,
  sortEvents,
  type MigrationEvent,
  type RepoRecord,
} from "@/lib/model";
import { AnalyzeIcon, Badge, ExampleIcon, Highlight, InternalLink, MagnifyIcon, Meter, UnassessableNote } from "@/components/ui";
import { EventAnalysisModal } from "./EventAnalysisModal";
import { EventCompareModal } from "./EventCompareModal";
import { EventExampleModal } from "./EventExampleModal";

export function GitHubLine({
  repo,
  contributors,
}: {
  repo: string;
  contributors: Array<{ name: string; login: string }>;
}) {
  return (
    <p className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <a
        href={githubRepoUrl(repo)}
        target="_blank"
        rel="noopener"
        className="text-[12px] underline decoration-dotted hover:opacity-70"
        style={{ color: "var(--text-secondary)" }}
      >
        GitHub ↗
      </a>
      {contributors.length > 0 ? (
        <span className="text-[12px]" style={{ color: "var(--text-secondary)" }}>
          {contributors.map((person, index) => (
            <span key={person.login}>
              {index > 0 ? ", " : null}
              <a
                href={`https://github.com/${person.login}`}
                target="_blank"
                rel="noopener"
                className="underline decoration-dotted hover:opacity-70"
              >
                {person.name}
              </a>
            </span>
          ))}
        </span>
      ) : null}
    </p>
  );
}

function bandFill(shade: number): string {
  return shade % 2 === 0 ? "var(--surface-2)" : "var(--surface-3)";
}

function iconBtnClass(disabled: boolean): string {
  return `inline-flex items-center justify-center rounded p-1 ${disabled ? "opacity-40" : "hover:opacity-70"}`;
}

export function EventRow({
  ev,
  query,
  tolerance,
  reason,
  band,
  shade,
  share,
  sharedDiff,
  extraNames,
  analysisCached,
  exampleCached,
  onExample,
  onInspect,
  onAnalyze,
}: {
  ev: MigrationEvent;
  query: string;
  tolerance: number;
  reason: string | null;
  band: GroupBand;
  shade: number;
  share: ShareRole;
  sharedDiff: number | null;
  extraNames: string[];
  analysisCached?: boolean;
  exampleCached?: boolean;
  onExample: () => void;
  onInspect: () => void;
  onAnalyze: (() => void) | null;
}) {
  const ampVol = ev.v30 > 0 ? fmt(ev.v30) : ev.dev30 > 0 ? `${fmt(ev.dev30)} (dev)` : "—";
  const aiVol = ev.ai30 == null ? "—" : fmt(ev.ai30);
  const diff = share === "lead" ? sharedDiff : share === "own" ? ampAiDiffPct(ev.v30, ev.ai30) : null;
  const tone = diffTone(diff, tolerance);
  const appIntel = share === "rest" ? extraNames : ev.legacy;
  const tmpl = isTemplateName(ev.name, ev.legacy);
  return (
    <tr
      className={band === "middle" || band === "end" ? undefined : "border-t"}
      data-group={band}
      style={{
        borderColor: "var(--grid)",
        background: band === "none" ? undefined : bandFill(shade),
      }}
    >
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
      <td className="py-1.5 pr-3 align-top text-right tabular-nums whitespace-nowrap">{ampVol}</td>
      <td className="py-1.5 pr-3 align-top txt-3 font-mono text-[11px]">
        {share === "rest" && appIntel.length === 0
          ? null
          : appIntel.length === 0
            ? "—"
            : appIntel.map((name, index) => (
                <span key={`${name}-${index}`} className="block whitespace-nowrap">
                  <Highlight text={name} query={query} />
                </span>
              ))}
      </td>
      <td className="py-1.5 pr-3 align-top text-right tabular-nums whitespace-nowrap">
        {share === "rest" ? null : aiVol}
      </td>
      <td className="py-1.5 pr-3 align-top text-right">
        {share === "rest" ? null : (
          <span className="tabular-nums whitespace-nowrap" style={tone ? { color: DIFF_INK[tone] } : undefined}>
            {diff == null ? "—" : `${diff}%`}
          </span>
        )}
        {reason ? (
          <span className="block txt-3 text-[10.5px] font-normal mt-0.5 ml-auto max-w-[14rem]" style={{ color: "var(--text-secondary)" }}>
            {reason}
          </span>
        ) : null}
      </td>
      <td className="py-1.5 pr-3 align-top">
        <Badge status={ev.status} />
      </td>
      <td className="py-1.5 align-top text-right whitespace-nowrap">
        <span className="inline-flex items-center gap-1">
          {onAnalyze ? (
            <button
              type="button"
              className={iconBtnClass(false)}
              aria-label={`Analyze ${ev.name}`}
              title="Analyze why this volume is outside tolerance"
              style={analysisCached ? { color: "var(--st-good-ink)" } : undefined}
              onClick={onAnalyze}
            >
              <AnalyzeIcon />
            </button>
          ) : null}
          <button
            type="button"
            className={iconBtnClass(false)}
            aria-label={`Example ${ev.name}`}
            title="Show an example event from both systems"
            style={exampleCached ? { color: "var(--st-good-ink)" } : undefined}
            onClick={onExample}
          >
            <ExampleIcon />
          </button>
          <button
            type="button"
            className={iconBtnClass(false)}
            aria-label={`Inspect ${ev.name}`}
            title="Compare daily Amplitude and App Intel volume"
            onClick={onInspect}
          >
            <MagnifyIcon />
          </button>
        </span>
      </td>
    </tr>
  );
}

function EventTable({
  repo,
  events,
  query,
  tolerance,
  reasons,
  cachedAnalyses,
  cachedExamples,
  onExample,
  onInspect,
  onAnalyze,
}: {
  repo: RepoRecord;
  events: MigrationEvent[];
  query: string;
  tolerance: number;
  reasons: Map<string, ReturnType<typeof explainEvent>>;
  cachedAnalyses: ReadonlySet<string>;
  cachedExamples: ReadonlySet<string>;
  onExample: (ev: MigrationEvent) => void;
  onInspect: (ev: MigrationEvent) => void;
  onAnalyze: (ev: MigrationEvent) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left border-collapse">
        <caption className="sr-only">Migrated events for {repo.repo}</caption>
        <thead>
          <tr className="txt-3 text-[10.5px] uppercase tracking-wider">
            <th scope="col" className="py-1.5 pr-3 font-semibold">
              Amplitude Event
            </th>
            <th scope="col" className="py-1.5 pr-3 font-semibold text-right">
              Amp Vol
            </th>
            <th scope="col" className="py-1.5 pr-3 font-semibold">
              App Intel Event
            </th>
            <th scope="col" className="py-1.5 pr-3 font-semibold text-right">
              AI Vol
            </th>
            <th scope="col" className="py-1.5 pr-3 font-semibold text-right">
              Diff
            </th>
            <th scope="col" className="py-1.5 pr-3 font-semibold">
              Status
            </th>
            <th scope="col" className="py-1.5 font-semibold text-right">
              <span className="sr-only">Inspect</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {groupRelatedEvents(events).map(({ event: e, band, shade, share, sharedDiff, extraNames }) => {
            const key = `${e.name}|${e.legacy.join(",")}`;
            const explanation = reasons.get(key);
            const noAmplitude = explanation?.kind === "no-amplitude";
            return (
              <EventRow
                key={key}
                ev={e}
                query={query}
                tolerance={tolerance}
                reason={
                  noAmplitude
                    ? "No Amplitude volume"
                    : share === "own" && explanation
                      ? reasonText(explanation)
                      : null
                }
                band={band}
                shade={shade}
                share={share}
                sharedDiff={sharedDiff}
                extraNames={extraNames}
                analysisCached={cachedAnalyses.has(e.name)}
                exampleCached={cachedExamples.has(e.name)}
                onExample={() => onExample(e)}
                onInspect={() => onInspect(e)}
                onAnalyze={explanation?.kind === "unexplained" ? () => onAnalyze(e) : null}
              />
            );
          })}
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
  const { tolerance, applied } = useVolumeWindow();
  const { live, scored, pct, unassessable } = repoCompletion(r);
  const events = sortEvents(r.events, "volume");
  const [contributors, setContributors] = useState<RepoContributor[]>([]);
  const [inspecting, setInspecting] = useState<MigrationEvent | null>(null);
  const [sampling, setSampling] = useState<MigrationEvent | null>(null);
  const [analyzing, setAnalyzing] = useState<MigrationEvent | null>(null);
  const [daily, setDaily] = useState<Array<{ eventName: string; source: "amp" | "ai"; day: string; count: number }>>([]);
  const [cachedAnalyses, setCachedAnalyses] = useState<ReadonlySet<string>>(new Set());
  const [cachedExamples, setCachedExamples] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    if (!applied) {
      setDaily([]);
      return;
    }
    let cancelled = false;
    const params = new URLSearchParams({ start: applied.start, end: applied.end });
    fetch(`/api/repos/${encodeURIComponent(r.repo)}/volume?${params}`)
      .then((res) => res.json() as Promise<{ rows?: Array<{ eventName: string; source: "amp" | "ai"; day: string; count: number }> }>)
      .then((body) => {
        if (!cancelled) setDaily(body.rows ?? []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [r.repo, applied]);

  useEffect(() => {
    if (!applied) {
      setCachedAnalyses(new Set());
      setCachedExamples(new Set());
      return;
    }
    let cancelled = false;
    const params = new URLSearchParams({ start: applied.start, end: applied.end });
    fetch(`/api/repos/${encodeURIComponent(r.repo)}/cached-events?${params}`)
      .then((res) => res.json() as Promise<{ analyses?: string[]; examples?: string[] }>)
      .then((body) => {
        if (cancelled) return;
        setCachedAnalyses(new Set(body.analyses ?? []));
        setCachedExamples(new Set(body.examples ?? []));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [r.repo, applied]);

  function rememberCached(kind: "analysis" | "example", name: string) {
    const update = kind === "analysis" ? setCachedAnalyses : setCachedExamples;
    update((current) => {
      if (current.has(name)) return current;
      const next = new Set(current);
      next.add(name);
      return next;
    });
  }

  const reasons = useMemo(() => {
    const map = new Map<string, ReturnType<typeof explainEvent>>();
    for (const event of events) {
      const days: DayVolume[] | null = applied
        ? eventVolumeSeries(
            applied,
            daily.filter((row) => row.eventName === event.name),
            event.ai30 != null,
          )
        : null;
      map.set(`${event.name}|${event.legacy.join(",")}`, explainEvent(event, events, days, tolerance));
    }
    return map;
  }, [events, daily, applied, tolerance]);
  const summary = explainSummary(explainCounts([...reasons.values()]));

  useEffect(() => {
    setContributors([]);
    let cancelled = false;
    fetch(`/api/repos/${encodeURIComponent(r.repo)}/contributors`)
      .then((res) => res.json() as Promise<{ contributors?: RepoContributor[] }>)
      .then((body) => {
        if (!cancelled) setContributors(body.contributors ?? []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [r.repo]);

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
          <GitHubLine repo={r.repo} contributors={contributors} />
          {summary ? <p className="txt-2 text-[12px] mt-2">{summary}</p> : null}
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
                <span className="txt-3 text-[10.5px] font-normal">events</span>
              </span>
            </>
          )}
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
            tolerance={tolerance}
            reasons={reasons}
            cachedAnalyses={cachedAnalyses}
            cachedExamples={cachedExamples}
            onExample={setSampling}
            onInspect={setInspecting}
            onAnalyze={setAnalyzing}
          />
        )}
      </section>
      {sampling ? (
        <EventExampleModal
          event={sampling}
          repo={r.repo}
          applied={applied}
          onCached={() => rememberCached("example", sampling.name)}
          onClose={() => setSampling(null)}
        />
      ) : null}
      {inspecting ? (
        <EventCompareModal
          event={inspecting}
          repo={r.repo}
          applied={applied}
          tolerance={tolerance}
          onClose={() => setInspecting(null)}
        />
      ) : null}
      {analyzing ? (
        <EventAnalysisModal
          event={analyzing}
          repo={r.repo}
          applied={applied}
          tolerance={tolerance}
          onCached={() => rememberCached("analysis", analyzing.name)}
          onClose={() => setAnalyzing(null)}
        />
      ) : null}
    </div>
  );
}
