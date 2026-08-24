import { useEffect, useState, type MouseEvent } from "react";
import "./index.css";
import { AppDetail } from "./AppDetail";
import { Dashboard } from "./Dashboard";
import { parseRoute, type DashboardData } from "./model";
import { NotFound, ThemeToggle } from "./ui";

export {
  appHref,
  dashboardSummary,
  eventMatches,
  fmt,
  isTemplateName,
  parseRoute,
  pctColor,
  repoCompletion,
  sortEvents,
  sparklinePath,
  topLiveByVolume,
  visibleRepos,
} from "./model";
export type {
  AppRoute,
  DashboardData,
  EventStatus,
  MigrationEvent,
  RepoRecord,
  SortBy,
  StatusFilter,
} from "./model";

export function App() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(null);
  const [pathname, setPathname] = useState(() => window.location.pathname);

  useEffect(() => {
    let cancelled = false;
    fetch("/data.json")
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load data.json (${res.status})`);
        return res.json() as Promise<DashboardData>;
      })
      .then((json) => {
        if (!cancelled) setData(json);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
      setTheme("dark");
    }
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    const onPop = () => setPathname(window.location.pathname);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    const base = "Analytics Migration Status — Workiva";
    const route = parseRoute(pathname);
    if (route.page === "unknown") {
      document.title = `Not found · ${base}`;
      return;
    }
    if (route.page === "app") {
      if (!data) return;
      const found = data.repos.some((r) => r.repo === route.repo);
      document.title = found ? `${route.repo} · ${base}` : `Not found · ${base}`;
      return;
    }
    document.title = base;
  }, [pathname, data]);

  function onTip(text: string | null, e?: MouseEvent) {
    if (!text || !e) {
      setTip(null);
      return;
    }
    const x = Math.min(e.clientX + 12, window.innerWidth - 160);
    setTip({ text, x, y: e.clientY + 16 });
  }

  const toggleTheme = () => setTheme((t) => (t === "dark" ? "light" : "dark"));

  if (error) {
    return (
      <div className="font-sans text-[13px] leading-relaxed max-w-[1180px] mx-auto px-5 py-7">
        <h1 className="text-[21px] font-bold tracking-tight">Analytics Migration Status</h1>
        <p className="mt-4" style={{ color: "var(--st-critical-ink)" }}>
          Could not load dashboard data: {error}
        </p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="font-sans text-[13px] leading-relaxed max-w-[1180px] mx-auto px-5 py-7 txt-2">
        Loading dashboard…
      </div>
    );
  }

  const route = parseRoute(pathname);
  const detailRepo = route.page === "app" ? data.repos.find((r) => r.repo === route.repo) : undefined;

  return (
    <div className="font-sans text-[13px] leading-relaxed">
      <div className="max-w-[1180px] mx-auto px-5 py-7 pb-24">
        {route.page === "home" ? (
          <Dashboard data={data} theme={theme} onToggleTheme={toggleTheme} onTip={onTip} />
        ) : (
          <>
            <div className="flex justify-end mb-1">
              <ThemeToggle theme={theme} onToggle={toggleTheme} />
            </div>
            {route.page === "unknown" ? (
              <NotFound message="That page does not exist." />
            ) : detailRepo ? (
              <AppDetail repo={detailRepo} onTip={onTip} />
            ) : (
              <NotFound
                message={`No application named “${route.page === "app" ? route.repo : ""}” is in this report.`}
              />
            )}
          </>
        )}
      </div>

      {tip ? (
        <div
          className="fixed z-50 pointer-events-none px-2.5 py-1.5 rounded-md text-[11.5px] shadow-lg"
          style={{
            background: "var(--text-primary)",
            color: "var(--surface-1)",
            left: tip.x,
            top: tip.y,
          }}
        >
          {tip.text}
        </div>
      ) : null}
    </div>
  );
}

export default App;
