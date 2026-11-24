import { expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import { AppHeader, RefreshProgress } from "./AppHeader";
import { VolumeWindowProvider } from "./VolumeWindowContext";

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
