import { type MouseEvent, type ReactNode } from "react";
import { type EventStatus } from "./model";

export const META: Record<EventStatus, { label: string; icon: string; color: string; ink: string }> = {
  live: { label: "Live", icon: "✓", color: "var(--st-good)", ink: "var(--st-good-ink)" },
  stale: { label: "Stale", icon: "△", color: "var(--st-warning)", ink: "var(--st-warning-ink)" },
  dev_only: { label: "Dev only", icon: "⚙", color: "var(--st-warning)", ink: "var(--st-warning-ink)" },
  blocked: { label: "Blocked", icon: "⊘", color: "var(--st-serious)", ink: "var(--st-serious-ink)" },
  missing: { label: "Not seen", icon: "✗", color: "var(--st-critical)", ink: "var(--st-critical-ink)" },
};

export function Highlight({ text, query }: { text: string; query: string }) {
  if (!query) return text;
  const i = text.toLowerCase().indexOf(query.toLowerCase());
  if (i < 0) return text;
  return (
    <>
      {text.slice(0, i)}
      <mark>{text.slice(i, i + query.length)}</mark>
      {text.slice(i + query.length)}
    </>
  );
}

export function Badge({ status }: { status: EventStatus }) {
  const m = META[status];
  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-semibold whitespace-nowrap"
      style={{ color: m.ink, background: `color-mix(in srgb, ${m.color} 15%, transparent)` }}
    >
      <span aria-hidden="true">{m.icon}</span>
      {m.label}
    </span>
  );
}

export function Meter({
  counts,
  total,
  onTip,
}: {
  counts: Partial<Record<EventStatus, number>>;
  total: number;
  onTip: (text: string | null, e?: MouseEvent) => void;
}) {
  if (!total) {
    return <div className="meter" role="img" aria-label="No mapped events" />;
  }
  const segs = [
    { n: counts.live || 0, c: "var(--st-good)", l: "live" },
    { n: (counts.blocked || 0) + (counts.dev_only || 0), c: "var(--st-info)", l: "blocked or dev-only" },
    { n: counts.stale || 0, c: "var(--st-warning)", l: "stale" },
    { n: counts.missing || 0, c: "var(--st-critical)", l: "not seen" },
  ].filter((x) => x.n);
  return (
    <div className="meter" role="img" aria-label={segs.map((x) => `${x.n} ${x.l}`).join(", ")}>
      {segs.map((x) => (
        <i
          key={x.l}
          style={{ width: `${((x.n / total) * 100).toFixed(2)}%`, background: x.c }}
          onMouseEnter={(e) => onTip(`${x.n} ${x.l}`, e)}
          onMouseMove={(e) => onTip(`${x.n} ${x.l}`, e)}
          onMouseLeave={() => onTip(null)}
        />
      ))}
    </div>
  );
}

export function navigate(href: string) {
  history.pushState({}, "", href);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function InternalLink({
  href,
  children,
  className,
  ariaLabel,
  onClick,
}: {
  href: string;
  children: ReactNode;
  className?: string;
  ariaLabel?: string;
  onClick?: (e: MouseEvent<HTMLAnchorElement>) => void;
}) {
  return (
    <a
      href={href}
      className={className}
      aria-label={ariaLabel}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        e.preventDefault();
        navigate(href);
      }}
    >
      {children}
    </a>
  );
}

export function MagnifyIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </svg>
  );
}

export function ThemeToggle({ theme, onToggle }: { theme: "light" | "dark"; onToggle: () => void }) {
  return (
    <button
      type="button"
      className="surf border rounded-md px-3 py-1.5 text-[12px] font-medium shrink-0 hover:opacity-80"
      onClick={onToggle}
    >
      <span>{theme === "dark" ? "☼" : "☾"}</span> <span>{theme === "dark" ? "Light" : "Dark"}</span>
    </button>
  );
}

export function UnassessableNote() {
  return (
    <p className="txt-2 text-[12px]">
      Listed in the spreadsheet inventory but with no next-gen mapping rows and no{" "}
      <code>ANALYTICS_MIGRATION_MAPPING.md</code>, so this application's migration state cannot be assessed.
    </p>
  );
}

export function NotFound({ message }: { message: string }) {
  return (
    <div>
      <p className="mb-4">
        <InternalLink href="/" className="txt-2 text-[12px] underline decoration-dotted hover:opacity-70">
          ← All applications
        </InternalLink>
      </p>
      <h1 className="text-[21px] font-bold tracking-tight">Not found</h1>
      <p className="txt-2 text-[13px] mt-2">{message}</p>
    </div>
  );
}
