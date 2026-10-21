import { useEffect, useState, type MouseEvent } from "react";
import { BrowserRouter, Outlet, Route, Routes, useLocation } from "react-router";
import { NotFound } from "@/components/ui";
import { parseRoute, type DashboardData } from "@/lib/model";
import { AppPage } from "@/routes/app/AppPage";
import { Dashboard } from "@/routes/dashboard/Dashboard";
import "../index.css";
import { AppHeader } from "./AppHeader";
import { VolumeWindowProvider } from "./VolumeWindowContext";

export type AppRoutesProps = {
  data: DashboardData;
  onData: (data: DashboardData) => void;
  theme: "light" | "dark";
  onToggleTheme: () => void;
  onTip: (text: string | null, e?: MouseEvent) => void;
};

function AppLayout({
  theme,
  onToggleTheme,
}: {
  theme: "light" | "dark";
  onToggleTheme: () => void;
}) {
  return (
    <>
      <AppHeader theme={theme} onToggleTheme={onToggleTheme} />
      <Outlet />
    </>
  );
}

export function AppRoutes({ data, onData, theme, onToggleTheme, onTip }: AppRoutesProps) {
  return (
    <VolumeWindowProvider>
      <Routes>
        <Route element={<AppLayout theme={theme} onToggleTheme={onToggleTheme} />}>
          <Route index element={<Dashboard data={data} onData={onData} onTip={onTip} />} />
          <Route path="app/:repo" element={<AppPage data={data} onTip={onTip} />} />
          <Route path="*" element={<NotFound message="That page does not exist." />} />
        </Route>
      </Routes>
    </VolumeWindowProvider>
  );
}

function AppShell({
  data,
  error,
  theme,
  onToggleTheme,
  onData,
  onTip,
}: {
  data: DashboardData | null;
  error: string | null;
  theme: "light" | "dark";
  onToggleTheme: () => void;
  onData: (data: DashboardData) => void;
  onTip: (text: string | null, e?: MouseEvent) => void;
}) {
  const location = useLocation();

  useEffect(() => {
    const base = "Analytics Migration Status — Workiva";
    const route = parseRoute(location.pathname);
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
  }, [location.pathname, data]);

  if (error) {
    return (
      <>
        <h1 className="text-[21px] font-bold tracking-tight">Analytics Migration Status</h1>
        <p className="mt-4" style={{ color: "var(--st-critical-ink)" }}>
          Could not load dashboard data: {error}
        </p>
      </>
    );
  }

  if (!data) {
    return <div className="txt-2">Loading dashboard…</div>;
  }

  return <AppRoutes data={data} onData={onData} theme={theme} onToggleTheme={onToggleTheme} onTip={onTip} />;
}

export function App() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(null);

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

  function onTip(text: string | null, e?: MouseEvent) {
    if (!text || !e) {
      setTip(null);
      return;
    }
    const x = Math.min(e.clientX + 12, window.innerWidth - 160);
    setTip({ text, x, y: e.clientY + 16 });
  }

  const toggleTheme = () => setTheme((t) => (t === "dark" ? "light" : "dark"));

  return (
    <BrowserRouter>
      <div className="font-sans text-[13px] leading-relaxed">
        <div className="max-w-[1180px] mx-auto px-5 py-7 pb-24">
          <AppShell
            data={data}
            error={error}
            theme={theme}
            onToggleTheme={toggleTheme}
            onData={setData}
            onTip={onTip}
          />
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
    </BrowserRouter>
  );
}

export default App;
