import { expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router";
import type { DashboardData } from "@/lib/model";
import { AppRoutes } from "./App";

const data: DashboardData = {
  provenance: "mapping",
  volumeAsOf: "2026-09-13",
  repos: [
    {
      repo: "wdesk_sdk",
      events: [
        {
          name: "Clicked Save",
          legacy: [],
          status: "live",
          v30: 1500,
          v365: 1500,
          dev30: 0,
          merged: false,
          pr: null,
          amp_count: 1,
          ss_error: "",
          queried: 0,
        },
      ],
      counts: { live: 1 },
      total: 1,
      live: 1,
      volume30: 1500,
      volume30Ai: 1600,
      sources: [],
      prs: [],
      inv_mapped: 0,
      inv_unmapped: 0,
    },
  ],
};

function renderAt(path: string): string {
  return renderToString(
    <MemoryRouter initialEntries={[path]}>
      <AppRoutes data={data} onData={() => {}} theme="light" onToggleTheme={() => {}} onTip={() => {}} />
    </MemoryRouter>,
  );
}

test("home and app routes share the date window header", () => {
  const home = renderAt("/");
  const app = renderAt("/app/wdesk_sdk");
  for (const html of [home, app]) {
    expect(html).toContain('aria-label="Window start date"');
    expect(html).toContain('aria-label="Window end date"');
    expect(html).toContain('aria-label="Apply date window"');
    expect(html).toContain('value="2026-08-17"');
    expect(html).toContain('value="2026-08-18"');
  }
  expect(home).toContain(">Analytics Migration</h1>");
  expect(home).not.toContain("user_analytics");
  expect(app).toContain(">Analytics Migration</h1>");
  expect(app).toContain("wdesk_sdk");
  expect(app).toContain("All applications");
});
