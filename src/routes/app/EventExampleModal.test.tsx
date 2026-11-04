import { expect, test } from "bun:test";
import type { EventSample } from "@/lib/eventSample";
import { renderToString } from "react-dom/server";
import type { MigrationEvent } from "@/lib/model";
import { EventExampleModal } from "./EventExampleModal";

const event = (over: Partial<MigrationEvent> = {}): MigrationEvent => ({
  name: "Rename Outline Title",
  legacy: ["OutlineRenameTitleEventV1"],
  status: "live",
  v30: 40,
  v365: 0,
  dev30: 0,
  merged: false,
  pr: null,
  amp_count: 1,
  ss_error: "",
  queried: 0,
  ai30: 25,
  ...over,
});

const paired: EventSample = {
  paired: true,
  amp: {
    eventTime: "2026-08-19 15:01:02",
    user: "user-1",
    organization: "org-1",
    workspace: "ws-1",
    duration: "12",
    environment: "us",
    pageUrl: "https://app.example/a",
    host: "app.example",
    properties: { experienceName: "Outline" },
  },
  ai: {
    eventTime: "2026-08-19 15:01:02",
    user: "user-1",
    organization: "org-1",
    workspace: "ws-1",
    duration: "12",
    environment: "production",
    pageUrl: "https://app.example/a",
    host: "app.example",
    properties: { browser: "Chrome", os: "macOS" },
  },
};

test("example modal shows one paired event side by side", () => {
  const html = renderToString(
    <EventExampleModal
      event={event()}
      repo="w_outline"
      applied={{ start: "2026-08-17", end: "2026-08-19" }}
      sample={paired}
      onClose={() => {}}
    />,
  );
  expect(html).toContain(">Example<");
  expect(html).toContain("Rename Outline Title");
  expect(html).toContain("OutlineRenameTitleEventV1");
  expect(html).toContain("text-[16px]");
  expect(html).toContain("background:var(--surface-3)");
  expect(html).toContain("color:var(--st-good-ink)");
  expect(html).toContain("color:var(--st-critical-ink)");
  expect(html).toContain("color:var(--text-primary)");
  const user = html.indexOf(">user-1<");
  const environment = html.indexOf(">production<");
  const outline = html.indexOf(">Outline<");
  expect(html.slice(user - 80, user)).toContain("color:var(--st-good-ink)");
  expect(html.slice(environment - 80, environment)).toContain("color:var(--st-critical-ink)");
  expect(html.slice(outline - 80, outline)).toContain("color:var(--text-primary)");
  expect(html).toContain("Same event in Amplitude and App Intel.");
  expect(html).toContain("user-1");
  expect(html).toContain("production");
  expect(html).toContain("experienceName");
  expect(html).toContain("Outline");
  expect(html).toContain("browser");
  expect(html).toContain("Chrome");
  expect(html).toContain("os");
  expect(html).toContain("macOS");
  expect(html.indexOf(">experienceName<")).toBeLessThan(html.indexOf(">Outline<"));
  expect(html.indexOf(">Amplitude<")).toBeLessThan(html.indexOf(">App Intel<"));
  expect(html).not.toContain("Loading example");
  expect(html).not.toContain(">Diff<");
});
