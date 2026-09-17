import { expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import { Dashboard } from "./Dashboard";
import type { DashboardData } from "./model";

const data: DashboardData = {
  provenance: "mapping",
  volumeAsOf: "2026-09-13",
  volumeRefreshedAt: "2026-09-13T00:00:00.000Z",
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

test("homepage shows Refresh, Updated copy, and Amp vs AI card totals", () => {
  const html = renderToString(
    <Dashboard
      data={data}
      onData={() => {}}
      theme="light"
      onToggleTheme={() => {}}
      onTip={() => {}}
      now={new Date("2026-09-16T18:00:00Z")}
    />,
  );
  expect(html).toContain("Refresh");
  expect(html).toContain("Updated 3 days ago");
  expect(html).toContain("Amp");
  expect(html).toContain("AI");
  expect(html).toContain("2K");
  expect(html).toContain("hover:opacity-80");
  expect(html).toContain("disabled:opacity-40");
  expect(html).toContain('aria-busy="false"');
});
