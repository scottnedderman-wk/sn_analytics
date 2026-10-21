import { expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import { AppHeader } from "./AppHeader";
import { VolumeWindowProvider } from "./VolumeWindowContext";

test("header shows start, end, Apply, and theme next to each other", () => {
  const html = renderToString(
    <VolumeWindowProvider>
      <AppHeader theme="light" onToggleTheme={() => {}} />
    </VolumeWindowProvider>,
  );
  const start = html.indexOf('aria-label="Window start date"');
  const end = html.indexOf('aria-label="Window end date"');
  const apply = html.indexOf('aria-label="Apply date window"');
  const theme = html.indexOf(">Dark</span>");
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  expect(apply).toBeGreaterThan(end);
  expect(theme).toBeGreaterThan(apply);
  expect(html).toContain('value="2026-08-17"');
  expect(html).toContain('value="2026-08-18"');
  expect(html).toContain("Apply");
  expect(html).toMatch(/<button[^>]*aria-label="Apply date window"[^>]*disabled/);
});
