import { expect, test } from "bun:test";
import type { EventSample } from "@/lib/eventSample";
import { renderToString } from "react-dom/server";
import type { MigrationEvent } from "@/lib/model";
import { EventCompareModal } from "./EventCompareModal";

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

test("modal lists each day in the applied window with the same diff coloring", () => {
  const html = renderToString(
    <EventCompareModal
      event={event()}
      repo="w_outline"
      applied={{ start: "2026-08-17", end: "2026-08-19" }}
      tolerance={5}
      days={[
        { date: "2026-08-17", amp: 1000, ai: 1100 },
        { date: "2026-08-18", amp: 0, ai: 5 },
        { date: "2026-08-19", amp: 1600, ai: 1600 },
      ]}
      onClose={() => {}}
    />,
  );
  expect(html).toContain("Rename Outline Title");
  expect(html).toContain("OutlineRenameTitleEventV1");
  expect(html).toContain("2026-08-17 – 2026-08-19");
  expect(html).toContain("2026-08-17");
  expect(html).toContain("2026-08-18");
  expect(html).toContain("2026-08-19");
  expect(html).toContain(">2,600<");
  expect(html).toContain(">2,705<");
  expect(html).toContain(">-10%<");
  expect(html).toContain(">0%<");
  expect(html).toContain("color:var(--st-critical-ink)");
  expect(html).toContain("color:var(--st-good-ink)");
  expect(html).toContain("w-[80vw]");
  expect(html).not.toContain("pending");
  expect(html).not.toContain("Comparable fields");
  expect(html).not.toContain("Last refreshed");
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

test("modal shows one paired example side by side", () => {
  const html = renderToString(
    <EventCompareModal
      event={event()}
      repo="w_outline"
      applied={{ start: "2026-08-17", end: "2026-08-19" }}
      tolerance={5}
      days={[{ date: "2026-08-19", amp: 1, ai: 1 }]}
      sample={paired}
      onClose={() => {}}
    />,
  );
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
});

test("modal leaves App Intel blank when the event has no identity", () => {
  const html = renderToString(
    <EventCompareModal
      event={event({ ai30: null })}
      repo="w_outline"
      applied={{ start: "2026-08-17", end: "2026-08-17" }}
      tolerance={5}
      days={[{ date: "2026-08-17", amp: 4, ai: null }]}
      onClose={() => {}}
    />,
  );
  expect(html).toContain(">4<");
  expect(html).toContain(">—</dd>");
  expect(html).not.toContain(">-");
});
