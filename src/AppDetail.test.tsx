import { expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import {
  AppDetail,
  EventRow,
  isRefreshAllDisabled,
  isRefreshBusy,
} from "./AppDetail";
import { contractsForRepo } from "./eventCompare";
import type { MigrationEvent, RepoRecord } from "./model";

const event = (over: Partial<MigrationEvent> = {}): MigrationEvent => ({
  name: "Clicked Save",
  legacy: ["SaveEventV1"],
  status: "live",
  v30: 100,
  v365: 500,
  dev30: 0,
  merged: false,
  pr: null,
  amp_count: 1,
  ss_error: "",
  queried: 0,
  ...over,
});

const repo = (over: Partial<RepoRecord> = {}): RepoRecord => ({
  repo: "w_outline",
  events: [event()],
  counts: { live: 1 },
  total: 1,
  live: 1,
  volume30: 100,
  sources: ["burn"],
  prs: [],
  inv_mapped: 1,
  inv_unmapped: 0,
  ...over,
});

const gel = event({ name: "General Experience Loading", legacy: ["GeneralExperienceLoadingEventV2"] });

function refreshButtonHtml(html: string, eventName: string): string {
  const match = html.match(new RegExp(`<button[^>]*aria-label="Refresh comparison for ${eventName}"[^>]*>`));
  if (!match) throw new Error(`missing refresh button for ${eventName}`);
  return match[0];
}

function refreshAllButtonHtml(html: string): string {
  const match = html.match(/<button[^>]*>Refresh all<\/button>/);
  if (!match) throw new Error("missing Refresh all button");
  return match[0];
}

function hasDisabledAttr(tag: string): boolean {
  return /\sdisabled(?:=|>|\s)/.test(tag);
}

test("GEL refresh is enabled and an uncontracted event refresh is disabled", () => {
  const gelHtml = renderToString(
    <EventRow ev={gel} query="" row={null} busy={new Set()} onRefresh={() => {}} onInspect={() => {}} />,
  );
  const otherHtml = renderToString(
    <EventRow ev={event()} query="" row={null} busy={new Set()} onRefresh={() => {}} onInspect={() => {}} />,
  );
  expect(refreshButtonHtml(gelHtml, gel.name)).not.toContain("disabled");
  expect(refreshButtonHtml(otherHtml, event().name)).toContain("disabled");
});

test("refresh buttons are disabled while busy for all or that event", () => {
  const allBusy = renderToString(
    <EventRow ev={gel} query="" row={null} busy={new Set(["*"])} onRefresh={() => {}} onInspect={() => {}} />,
  );
  const eventBusy = renderToString(
    <EventRow
      ev={gel}
      query=""
      row={null}
      busy={new Set([gel.name])}
      onRefresh={() => {}}
      onInspect={() => {}}
    />,
  );
  const otherBusy = renderToString(
    <EventRow ev={gel} query="" row={null} busy={new Set(["other"])} onRefresh={() => {}} onInspect={() => {}} />,
  );
  expect(isRefreshBusy(new Set(["*"]), gel.name)).toBe(true);
  expect(isRefreshBusy(new Set([gel.name]), gel.name)).toBe(true);
  expect(refreshButtonHtml(allBusy, gel.name)).toContain("disabled");
  expect(refreshButtonHtml(eventBusy, gel.name)).toContain("disabled");
  expect(refreshButtonHtml(otherBusy, gel.name)).not.toContain("disabled");
});

test("Refresh all is disabled when the repo has no contracts", () => {
  expect(contractsForRepo("w_outline")).toEqual([]);
  expect(isRefreshAllDisabled("w_outline", false)).toBe(true);
  expect(isRefreshAllDisabled("wdesk_sdk", false)).toBe(false);
  expect(isRefreshAllDisabled("wdesk_sdk", true)).toBe(true);

  const none = renderToString(<AppDetail repo={repo()} onTip={() => {}} />);
  const sdk = renderToString(
    <AppDetail
      repo={repo({ repo: "wdesk_sdk", events: [gel], counts: { live: 1 }, total: 1, live: 1 })}
      onTip={() => {}}
    />,
  );
  expect(hasDisabledAttr(refreshAllButtonHtml(none))).toBe(true);
  expect(hasDisabledAttr(refreshAllButtonHtml(sdk))).toBe(false);
});
