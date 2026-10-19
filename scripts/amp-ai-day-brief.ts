import { topLiveByVolume, type DashboardData } from "../src/model";

const DAY = "2026-09-09";
const DAY_LABEL = "September 9, 2026";
const DAY_SHORT = "9/9/2026";
const htmlPath = new URL("../.tmp/amp-ai-day-brief.html", import.meta.url);
const pdfPath = new URL("../docs/amp-vs-app-intel-top5-2026-09-09.pdf", import.meta.url);

const data = (await Bun.file(new URL("../src/data.json", import.meta.url)).json()) as DashboardData;
const days = data.volumeWindowDays ?? 30;
const asOf = data.volumeAsOf;
if (!asOf) throw new Error("data.json is missing volumeAsOf");

const end = new Date(`${asOf}T00:00:00Z`);
const start = new Date(end);
start.setUTCDate(start.getUTCDate() - (days - 1));
const dates = Array.from({ length: days }, (_, i) => {
  const d = new Date(start);
  d.setUTCDate(start.getUTCDate() + i);
  return d.toISOString().slice(0, 10);
});
const idx = dates.indexOf(DAY);
if (idx < 0) throw new Error(`${DAY} is not in the stored window ${dates[0]}–${dates.at(-1)}`);

type Row = {
  name: string;
  amp: number;
  ai: number | null;
};

type RepoBlock = {
  repo: string;
  rows: Row[];
  amp: number;
  ai: number | null;
};

function fmtCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1_000)}K`;
  return n.toLocaleString("en-US");
}

function pctDiff(amp: number, ai: number | null): number | null {
  if (ai == null || amp === 0) return null;
  return (ai - amp) / amp;
}

function fmtPct(p: number | null): string {
  if (p == null) return "—";
  const pct = p * 100;
  const digits = Math.abs(pct) < 10 ? 1 : 0;
  const body = `${pct > 0 ? "+" : ""}${pct.toFixed(digits)}%`;
  return body;
}

function pctClass(p: number | null): string {
  if (p == null) return "muted";
  const a = Math.abs(p);
  if (a <= 0.1) return "ok";
  if (a <= 0.25) return "mid";
  return "far";
}

const repos: RepoBlock[] = data.repos
  .map((repo) => {
    const rows: Row[] = topLiveByVolume(repo.events, 5).map((ev) => ({
      name: ev.name,
      amp: ev.series30?.[idx] ?? 0,
      ai: Array.isArray(ev.aiSeries30) ? (ev.aiSeries30[idx] ?? 0) : null,
    }));
    const amp = rows.reduce((s, r) => s + r.amp, 0);
    const aiRows = rows.filter((r) => r.ai != null);
    const ai = aiRows.length ? aiRows.reduce((s, r) => s + (r.ai ?? 0), 0) : null;
    return { repo: repo.repo, rows, amp, ai };
  })
  .filter((r) => r.rows.length > 0)
  .sort((a, b) => b.amp - a.amp || a.repo.localeCompare(b.repo));

const allRows = repos.flatMap((r) => r.rows);
const ampTotal = allRows.reduce((s, r) => s + r.amp, 0);
const aiTotal = allRows.reduce((s, r) => s + (r.ai ?? 0), 0);
const comparable = allRows.filter((r) => r.ai != null && r.amp > 0);
const within10 = comparable.filter((r) => Math.abs(pctDiff(r.amp, r.ai)!) <= 0.1).length;
const within25 = comparable.filter((r) => {
  const a = Math.abs(pctDiff(r.amp, r.ai)!);
  return a > 0.1 && a <= 0.25;
}).length;
const over25 = comparable.filter((r) => Math.abs(pctDiff(r.amp, r.ai)!) > 0.25).length;
const noAi = allRows.filter((r) => r.ai == null).length;
const abs = comparable.map((r) => Math.abs(pctDiff(r.amp, r.ai)!)).sort((a, b) => a - b);
const medianAbs = abs.length ? abs[Math.floor(abs.length / 2)]! : 0;
const overall = pctDiff(ampTotal, aiTotal);
const refreshed = data.volumeRefreshedAt
  ? new Date(data.volumeRefreshedAt).toISOString().slice(0, 10)
  : asOf;

const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Amplitude vs App Intel · ${DAY}</title>
  <style>
    :root { color-scheme: light; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; }
    body {
      font: 8.5pt/1.35 "Helvetica Neue", Helvetica, Arial, sans-serif;
      color: #1a1a1a;
    }
    @page {
      size: letter landscape;
      margin: 0.42in 0.45in 0.5in;
      @bottom-center {
        content: "Amplitude vs App Intel  ·  9/9/2026  ·  page " counter(page) " of " counter(pages);
        font-size: 7pt;
        color: #666;
      }
    }
    h1 { font-size: 16pt; font-weight: 600; margin: 0 0 2pt; letter-spacing: -0.02em; }
    .sub { color: #444; margin: 0 0 10pt; font-size: 9pt; }
    .kpis {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 8pt;
      margin-bottom: 10pt;
    }
    .kpi {
      border: 1px solid #d6d6d6;
      padding: 7pt 8pt 6pt;
    }
    .kpi .label { font-size: 7.5pt; text-transform: uppercase; letter-spacing: 0.04em; color: #666; }
    .kpi .value { font-size: 14pt; font-weight: 600; margin-top: 1pt; }
    .kpi .note { font-size: 7.5pt; color: #555; }
    .lede { margin: 0 0 10pt; max-width: 100%; }
    .cols {
      columns: 3;
      column-gap: 14pt;
    }
    .repo {
      break-inside: avoid;
      margin: 0 0 9pt;
    }
    .repo h2 {
      font-size: 8.5pt;
      font-weight: 600;
      margin: 0 0 2pt;
      padding-bottom: 1pt;
      border-bottom: 1px solid #ccc;
      display: flex;
      justify-content: space-between;
      gap: 6pt;
    }
    .repo h2 span { font-weight: 500; color: #555; font-variant-numeric: tabular-nums; }
    table { width: 100%; border-collapse: collapse; }
    th, td { text-align: left; padding: 1.5pt 3pt; vertical-align: top; }
    th { font-size: 6.5pt; text-transform: uppercase; letter-spacing: 0.03em; color: #666; font-weight: 600; }
    td { font-variant-numeric: tabular-nums; }
    td.num, th.num { text-align: right; }
    td.event { width: 52%; }
    .ok { color: #1a1a1a; }
    .mid { color: #8a5a00; }
    .far { color: #9b1c1c; font-weight: 600; }
    .muted { color: #888; }
    footer {
      margin-top: 8pt;
      font-size: 7pt;
      color: #555;
      border-top: 1px solid #ddd;
      padding-top: 5pt;
    }
  </style>
</head>
<body>
  <h1>Amplitude vs App Intel</h1>
  <p class="sub">Top 5 live events per application · one UTC day · ${DAY_SHORT}</p>
  <div class="kpis">
    <div class="kpi">
      <div class="label">Amplitude</div>
      <div class="value">${fmtCount(ampTotal)}</div>
      <div class="note">${allRows.length} events across ${repos.length} apps</div>
    </div>
    <div class="kpi">
      <div class="label">App Intel</div>
      <div class="value">${fmtCount(aiTotal)}</div>
      <div class="note">${noAi} events with no AI identity</div>
    </div>
    <div class="kpi">
      <div class="label">Volume difference</div>
      <div class="value ${pctClass(overall)}">${fmtPct(overall)}</div>
      <div class="note">(App Intel − Amp) / Amp</div>
    </div>
    <div class="kpi">
      <div class="label">Typical event gap</div>
      <div class="value">${fmtPct(medianAbs).replace("+", "")}</div>
      <div class="note">median |Δ%| · ${within10} of ${comparable.length} within ±10%</div>
    </div>
  </div>
  <p class="lede">
    ${DAY_LABEL} is the last full day both streams are populated.
    App Intel is incomplete on September 10 and empty September 11–15; Amplitude continues.
    Ranked by 30-day Amplitude volume (same top 5 as the homepage).
    ${within10} events agree within 10%, ${within25} are 10–25% apart, and ${over25} differ by more than 25%.
  </p>
  <div class="cols">
    ${repos
      .map((repo) => {
        const p = pctDiff(repo.amp, repo.ai);
        return `<section class="repo">
      <h2>${esc(repo.repo)} <span>${fmtCount(repo.amp)} Amp · ${repo.ai == null ? "—" : fmtCount(repo.ai)} AI · ${fmtPct(p)}</span></h2>
      <table>
        <thead><tr><th class="event">Event</th><th class="num">Amp</th><th class="num">AI</th><th class="num">Δ%</th></tr></thead>
        <tbody>
          ${repo.rows
            .map((row) => {
              const d = pctDiff(row.amp, row.ai);
              return `<tr>
            <td class="event">${esc(row.name)}</td>
            <td class="num">${fmtCount(row.amp)}</td>
            <td class="num">${row.ai == null ? "—" : fmtCount(row.ai)}</td>
            <td class="num ${pctClass(d)}">${fmtPct(d)}</td>
          </tr>`;
            })
            .join("")}
        </tbody>
      </table>
    </section>`;
      })
      .join("\n")}
  </div>
  <footer>
    Δ% = (App Intel − Amplitude) / Amplitude for that UTC day. Positive means App Intel is higher.
    “—” means no App Intel identity, or Amplitude is zero so a percent is undefined.
    Source: homepage Snowflake refresh ${refreshed}; window ending ${asOf}. Not a 30-day total.
  </footer>
</body>
</html>
`;

function esc(s: string): string {
  return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

await Bun.write(htmlPath, html);

const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const proc = Bun.spawn(
  [
    chrome,
    "--headless=new",
    "--disable-gpu",
    "--no-pdf-header-footer",
    `--print-to-pdf=${pdfPath.pathname}`,
    htmlPath.href,
  ],
  { stdout: "inherit", stderr: "inherit" },
);
const code = await proc.exited;
if (code !== 0) throw new Error(`Chrome print failed (${code})`);
console.log(`Wrote ${pdfPath.pathname}`);
console.log(
  JSON.stringify(
    {
      day: DAY,
      apps: repos.length,
      events: allRows.length,
      ampTotal,
      aiTotal,
      overallPct: overall,
      within10,
      comparable: comparable.length,
    },
    null,
    2,
  ),
);
