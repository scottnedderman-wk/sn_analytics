import { expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import { AppHeader, RefreshProgress } from "./AppHeader";
import { VolumeWindowProvider } from "./VolumeWindowContext";

test("header shows start, end, Apply, and theme next to each other", () => {
  const html = renderToString(
    <VolumeWindowProvider onData={() => {}}>
      <AppHeader theme="light" onToggleTheme={() => {}} />
    </VolumeWindowProvider>,
  );
  const title = html.indexOf(">Analytics Migration</h1>");
  const tolerance = html.indexOf('aria-label="Diff tolerance"');
  const start = html.indexOf('aria-label="Window start date"');
  const end = html.indexOf('aria-label="Window end date"');
  const apply = html.indexOf('aria-label="Apply date window"');
  const theme = html.indexOf(">Dark</span>");
  const hiddenToggle = html.indexOf('class="hidden"');
  expect(title).toBeGreaterThan(-1);
  expect(tolerance).toBeGreaterThan(title);
  expect(start).toBeGreaterThan(tolerance);
  expect(html.slice(tolerance, start)).toContain("ml-6");
  expect(html).toContain(">Tolerance<");
  expect(html).toContain('<option value="5" selected="">5</option>');
  for (const n of [1, 2, 3, 4, 6, 7, 8, 9, 10]) {
    expect(html).toContain(`<option value="${n}">${n}</option>`);
  }
  expect(html).not.toContain("Analytics Migration Status");
  expect(end).toBeGreaterThan(start);
  expect(apply).toBeGreaterThan(end);
  expect(theme).toBeGreaterThan(apply);
  expect(hiddenToggle).toBeGreaterThan(apply);
  expect(hiddenToggle).toBeLessThan(theme);
  expect(html).toContain('value="2026-08-17"');
  expect(html).toContain('value="2026-08-18"');
  expect(html).toContain("Apply");
  expect(html).toContain("sticky");
  expect(html).toContain("top-0");
  expect(html).toContain("var(--surface-3)");
  const applyTag = html.slice(apply, html.indexOf(">", apply) + 1);
  expect(applyTag).not.toMatch(/\sdisabled(?:="[^"]*")?(?=[\s>])/);
});

test("refresh progress names the current batch and how much is done", () => {
  const html = renderToString(
    <RefreshProgress completed={1} total={4} message="2026-08-17 – 2026-08-18 · Amplitude · events 1–100 of 400" />,
  );
  expect(html).toContain('role="progressbar"');
  expect(html).toContain('aria-valuenow="1"');
  expect(html).toContain('aria-valuemax="4"');
  expect(html).toContain("Amplitude · events 1–100 of 400");
  expect(html).toContain("width:25%");
});
