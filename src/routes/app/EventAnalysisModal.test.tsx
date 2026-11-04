import { expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import type { EventAnalysis } from "@/lib/eventAnalysis";
import type { MigrationEvent } from "@/lib/model";
import { EventAnalysisModal, formatDuration } from "./EventAnalysisModal";

const event = (): MigrationEvent => ({
  name: "Open Workspace",
  legacy: ["WorkspaceOpenEventV3"],
  status: "live",
  v30: 1,
  v365: 0,
  dev30: 0,
  merged: false,
  pr: null,
  amp_count: null,
  ss_error: "",
  queried: 0,
});

const finished: EventAnalysis = {
  day: "2026-08-18",
  regions: [],
  ampSampled: 0,
  ampMatched: 0,
  aiSampled: 0,
  aiMatched: 0,
  sentence: "",
  sections: [{ title: "Regions", paragraphs: ["The gap is spread across regions."] }],
  durationMs: 34_000,
};

test("duration formats as seconds or minutes", () => {
  expect(formatDuration(800)).toBe("1s");
  expect(formatDuration(34_000)).toBe("34s");
  expect(formatDuration(72_000)).toBe("1m 12s");
});

test("a running analysis shows a timer, progress, and a cache note", () => {
  const html = renderToString(
    <EventAnalysisModal
      event={event()}
      repo="wdesk_sdk"
      applied={{ start: "2026-08-17", end: "2026-08-20" }}
      tolerance={5}
      onClose={() => {}}
    />,
  );
  expect(html).toContain("Analyzing… 0s");
  expect(html).toContain('role="progressbar"');
  expect(html).toContain("Please be patient");
  expect(html).toContain("will be cached");
});

test("a finished analysis shows how long it took in the header", () => {
  const html = renderToString(
    <EventAnalysisModal
      event={event()}
      repo="wdesk_sdk"
      applied={{ start: "2026-08-17", end: "2026-08-20" }}
      tolerance={5}
      analysis={finished}
      onClose={() => {}}
    />,
  );
  expect(html).toContain("2026-08-18 · Produced in 34s");
  expect(html).toContain("The gap is spread across regions.");
  expect(html).not.toContain("Please be patient");
});
