import { expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import { compareRowFromCache, compareRowFromContract } from "@/lib/eventCompare";
import { EventCompareModal } from "./EventCompareModal";

test("GEL modal lists comparable fields and omitted note", () => {
  const row = compareRowFromContract("General Experience Loading")!;
  const html = renderToString(
    <EventCompareModal row={row} legacy={["GeneralExperienceLoadingEventV2"]} onClose={() => {}} />,
  );
  expect(html).toContain("General Experience Loading");
  expect(html).toContain("dimensions:timestamp");
  expect(html).toContain("event_date");
  expect(html).toContain("dimensions:url");
  expect(html).toContain("page_url");
  expect(html).toContain("dimensions:host");
  expect(html).toContain("page_domain");
  expect(html).toContain("Populated");
  expect(html).toContain("pending");
  expect(html).toContain("experience_name");
  expect(html).toContain("page_location");
  expect(html).toContain("page_path");
  expect(html).not.toContain("analytic_date");
  expect(html).not.toContain("same event instance");
  expect(html).toContain("w-[80vw]");
  expect(html).not.toContain("max-w-3xl");
});

test("GEL modal lists daily volume when the snapshot has overlap days", () => {
  const row = compareRowFromCache(
    "General Experience Loading",
    {
      version: 1,
      window: { start: "2026-08-18", end: "2026-08-24" },
      volume: { ai: 40, amp: 50 },
      daily: [
        { date: "2026-08-18", ai: 40, amp: 50 },
        { date: "2026-08-19", ai: null, amp: 50 },
      ],
      fields: [],
    },
    "2026-08-26T00:00:00.000Z",
    null,
  );
  const html = renderToString(
    <EventCompareModal row={row} legacy={["GeneralExperienceLoadingEventV2"]} onClose={() => {}} />,
  );
  expect(html).toContain("2026-08-18");
  expect(html).toContain("40");
  expect(html).toContain("50");
  expect(html).toContain("2026-08-19");
  expect(html).toMatch(/2026-08-19<\/td><td[^>]*>—</);
  expect(html).not.toMatch(/2026-08-19<\/td><td[^>]*>pending</);
  expect(html).toContain("warehouse lag");
});
