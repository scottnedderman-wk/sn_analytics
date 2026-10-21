import { expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { VolumeWindowProvider } from "@/app/VolumeWindowContext";
import type { DashboardData } from "@/lib/model";
import { Dashboard } from "./Dashboard";

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

test("homepage shows Refresh and Amp vs AI card totals", () => {
  const html = renderToString(
    <MemoryRouter>
      <VolumeWindowProvider onData={() => {}}>
        <Dashboard data={data} onTip={() => {}} />
      </VolumeWindowProvider>
    </MemoryRouter>,
  );
  expect(html).toContain("Refresh");
  expect(html).not.toContain("user_analytics");
  expect(html).toContain("Amp");
  expect(html).toContain("AI");
  expect(html).toContain("2K");
  expect(html).toContain("hover:opacity-80");
  expect(html).toContain("disabled:opacity-40");
  expect(html).toContain('aria-busy="false"');
  expect(html).toContain("grid-cols-4");
  expect(html).not.toContain("grid-cols-2");
  const count = html.indexOf('role="status"');
  const toggle = html.indexOf('aria-controls="status-legend"');
  const legend = html.indexOf("Status legend");
  const card = html.indexOf("wdesk_sdk");
  expect(count).toBeGreaterThan(-1);
  expect(toggle).toBeGreaterThan(count);
  expect(legend).toBeGreaterThan(toggle);
  expect(card).toBeGreaterThan(legend);
  expect(html).toContain('aria-expanded="false"');
  expect(html).toContain("Excluding blocked &amp; dev");
  expect(html).toContain('id="status-legend"');
  expect(html).toContain('hidden=""');
});
