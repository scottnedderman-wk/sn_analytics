export type EventStatus = "live" | "stale" | "dev_only" | "blocked" | "missing";
export type StatusFilter = "all" | EventStatus;
export type SortBy = "name" | "volume";

export type MigrationEvent = {
  name: string;
  legacy: string[];
  status: EventStatus;
  v30: number;
  v365: number;
  dev30: number;
  merged: boolean;
  pr: string | null;
  amp_count: number | null;
  ss_error: string;
  queried: number;
  series30?: number[];
  aiCategory?: string;
  aiAction?: string;
  aiEvent?: string;
  aiEventExclude?: string[];
  ai30?: number | null;
  aiSeries30?: number[];
};

export type RepoRecord = {
  repo: string;
  events: MigrationEvent[];
  counts: Partial<Record<EventStatus, number>>;
  total: number;
  live: number;
  volume30: number;
  volume30Ai?: number;
  sources: string[];
  prs: unknown[];
  inv_mapped: number;
  inv_unmapped: number;
};

export type DashboardData = {
  provenance: string;
  volumeAsOf?: string;
  volumeWindowDays?: number;
  volumeRefreshedAt?: string;
  repos: RepoRecord[];
};

export function formatUpdatedAgo(isoOrYmd: string, now = new Date()): string {
  const raw = isoOrYmd.length <= 10 ? `${isoOrYmd}T00:00:00.000Z` : isoOrYmd;
  const then = new Date(raw);
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const day = Date.UTC(then.getUTCFullYear(), then.getUTCMonth(), then.getUTCDate());
  const days = Math.round((today - day) / 86_400_000);
  if (days <= 0) return "Updated today";
  if (days === 1) return "Updated yesterday";
  return `Updated ${days} days ago`;
}

export type AppRoute = { page: "home" } | { page: "app"; repo: string } | { page: "unknown" };

export function fmt(n: number): string {
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(0) + "K";
  return String(n);
}

export function pctColor(pct: number): string {
  if (pct === 100) return "var(--st-good-ink)";
  if (pct >= 70) return "var(--text-primary)";
  return "var(--st-critical-ink)";
}

export function isTemplateName(name: string, legacy: string[]): boolean {
  return /[<>${}]/.test(name) || /[<>${}]/.test(legacy.join(","));
}

export function sortEvents(evs: MigrationEvent[], sortBy: SortBy): MigrationEvent[] {
  const out = evs.slice();
  if (sortBy === "volume") {
    out.sort((a, b) => {
      const av = a.v30 || a.dev30 || 0;
      const bv = b.v30 || b.dev30 || 0;
      return bv - av || a.name.localeCompare(b.name);
    });
  } else {
    out.sort((a, b) => a.name.localeCompare(b.name));
  }
  return out;
}

export function topLiveByVolume(events: MigrationEvent[], limit = 5): MigrationEvent[] {
  return sortEvents(
    events.filter((e) => e.status === "live"),
    "volume",
  ).slice(0, limit);
}

export function sparklinePath(values: number[], width: number, height: number): string {
  if (values.length < 2) return "";
  const max = Math.max(...values, 0);
  const span = max || 1;
  return values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * width;
      const y = height - (v / span) * height;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

export function eventMatches(ev: MigrationEvent, repo: string, query: string, filter: StatusFilter): boolean {
  if (filter !== "all" && ev.status !== filter) return false;
  if (!query) return true;
  return (
    ev.name.toLowerCase().includes(query) ||
    ev.legacy.some((l) => l.toLowerCase().includes(query)) ||
    repo.toLowerCase().includes(query)
  );
}

export function visibleRepos(
  repos: RepoRecord[],
  query: string,
  filter: StatusFilter,
  sortBy: SortBy,
): Array<{ repo: RepoRecord; events: MigrationEvent[] }> {
  const q = query.trim().toLowerCase();
  const out: Array<{ repo: RepoRecord; events: MigrationEvent[] }> = [];
  for (const r of repos) {
    const events = sortEvents(
      r.events.filter((e) => eventMatches(e, r.repo, q, filter)),
      sortBy,
    );
    const repoMatch = !q || r.repo.toLowerCase().includes(q);
    if (!events.length && !(repoMatch && r.total === 0 && filter === "all")) continue;
    out.push({ repo: r, events });
  }
  return out;
}

export function dashboardSummary(repos: RepoRecord[]) {
  const tracked = repos.length;
  const unassessable = repos.filter((r) => r.total === 0).length;
  const applications = tracked - unassessable;
  const mapped = repos.reduce((s, r) => s + r.total, 0);
  const live = repos.reduce((s, r) => s + (r.counts.live || 0), 0);
  const missing = repos.reduce((s, r) => s + (r.counts.missing || 0), 0);
  const scored = live + missing;
  const pct = scored ? Math.round((live / scored) * 100) : 0;
  return { tracked, unassessable, applications, mapped, live, missing, scored, pct };
}

export function appHref(repo: string): string {
  return `/app/${encodeURIComponent(repo)}`;
}

export function parseRoute(pathname: string): AppRoute {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === "/") return { page: "home" };
  const match = path.match(/^\/app\/([^/]+)$/);
  if (match?.[1]) return { page: "app", repo: decodeURIComponent(match[1]) };
  return { page: "unknown" };
}

export function repoCompletion(r: RepoRecord): {
  live: number;
  missing: number;
  scored: number;
  pct: number | null;
  unassessable: boolean;
} {
  const live = r.counts.live || 0;
  const missing = r.counts.missing || 0;
  const scored = live + missing;
  return {
    live,
    missing,
    scored,
    pct: scored ? Math.round((live / scored) * 100) : null,
    unassessable: r.total === 0,
  };
}

export function githubRepoUrl(repo: string): string {
  return `https://github.com/Workiva/${repo}`;
}
