import { expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import { compareRowFromContract } from "./eventCompare";
import { EventCompareModal } from "./EventCompareModal";

test("GEL modal lists comparable fields and omitted note", () => {
  const row = compareRowFromContract("General Experience Loading")!;
  const html = renderToString(
    <EventCompareModal row={row} legacy={["GeneralExperienceLoadingEventV2"]} onClose={() => {}} />,
  );
  expect(html).toContain("General Experience Loading");
  expect(html).toContain("analytic_date");
  expect(html).toContain("event_date");
  expect(html).toContain("Populated");
  expect(html).toContain("pending");
  expect(html).toContain("experience_name");
  expect(html).not.toContain("same event instance");
});
