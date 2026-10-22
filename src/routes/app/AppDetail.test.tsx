import { expect, test } from "bun:test";
import { type ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { VolumeWindowProvider } from "@/app/VolumeWindowContext";
import { AppDetail, GitHubLine } from "./AppDetail";
import type { MigrationEvent, RepoRecord } from "@/lib/model";

function renderDetail(node: ReactNode): string {
  return renderToString(
    <MemoryRouter>
      <VolumeWindowProvider onData={() => {}}>{node}</VolumeWindowProvider>
    </MemoryRouter>,
  );
}

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

test("GitHub line links each real name to that person's profile", () => {
  const html = renderToString(
    <GitHubLine
      repo="w_outline"
      contributors={[
        { name: "Rachael Reimanis", login: "rachaelreimanis-wk" },
        { name: "Grace Hopper", login: "grace" },
      ]}
    />,
  );
  const repoLink = html.indexOf('href="https://github.com/Workiva/w_outline"');
  const person = html.indexOf('href="https://github.com/rachaelreimanis-wk"');
  expect(repoLink).toBeGreaterThan(-1);
  expect(person).toBeGreaterThan(repoLink);
  expect(html).toContain(">Rachael Reimanis</a>");
  expect(html).toContain('href="https://github.com/grace"');
  expect(html).toContain(">Grace Hopper</a>");

  const empty = renderToString(<GitHubLine repo="w_outline" contributors={[]} />);
  expect(empty).toContain(">GitHub ↗</a>");
  expect(empty).not.toContain("Rachael Reimanis");
});

test("detail table omits Usage, GitHub, Match, and the row refresh icon", () => {
  const html = renderDetail(
    <AppDetail
      repo={repo({
        events: [event({ queried: 4, merged: true, pr: "https://example.com/pr/1" })],
      })}
      onTip={() => {}}
    />,
  );
  const amplitude = html.indexOf("Amplitude Event");
  const ampVol = html.indexOf("Amp Vol");
  const appIntel = html.indexOf("App Intel Event");
  const aiVol = html.indexOf("AI Vol");
  const diff = html.indexOf(">Diff<");
  const status = html.indexOf(">Status<");
  expect(amplitude).toBeGreaterThan(-1);
  expect(ampVol).toBeGreaterThan(amplitude);
  expect(appIntel).toBeGreaterThan(ampVol);
  expect(aiVol).toBeGreaterThan(appIntel);
  expect(diff).toBeGreaterThan(aiVol);
  expect(status).toBeGreaterThan(diff);
  expect(html).not.toContain("30d volume");
  expect(html).not.toContain("New (Amplitude) event");
  expect(html).not.toContain("Legacy name");
  expect(html).toContain('aria-label="Inspect Clicked Save"');
  expect(html).toContain(">events</span>");
  expect(html).not.toContain("30d events");
  expect(html).not.toContain("Refresh all");
  expect(html).not.toContain("Last refreshed");
  expect(html).not.toContain(">Usage<");
  expect(html).not.toContain(">GitHub<");
  expect(html).not.toContain(">Match<");
  expect(html).not.toContain("Refresh comparison");
  expect(html).not.toContain("queries");
  expect(html).not.toContain("https://example.com/pr/1");
});

test("Amp Vol and AI Vol show each event's volumes", () => {
  const html = renderDetail(
    <AppDetail repo={repo({ events: [event({ v30: 1000, ai30: 2000 })] })} onTip={() => {}} />,
  );
  expect(html).toContain(">1K<");
  expect(html).toContain(">2K<");
  expect(html).toContain(">-100%<");
  expect(html).toContain("color:var(--st-critical-ink)");

  const matched = renderDetail(
    <AppDetail repo={repo({ events: [event({ v30: 1000, ai30: 1000 })] })} onTip={() => {}} />,
  );
  expect(matched).toContain(">0%<");
  expect(matched).toContain("color:var(--st-good-ink)");

  const missing = renderDetail(
    <AppDetail repo={repo({ events: [event({ v30: 1000, ai30: null })] })} onTip={() => {}} />,
  );
  expect(missing).toContain(">1K<");
  expect(missing).toContain(">—</span>");
  expect(missing).not.toContain(">2K<");
});

test("shared identities are labeled and only unexplained rows can be analyzed", () => {
  const html = renderDetail(
    <AppDetail
      repo={repo({
        events: [
          event({ name: "Expand", v30: 1000, ai30: 2000, aiCategory: "outline", aiAction: "expand" }),
          event({ name: "Collapse", v30: 1000, ai30: 2000, aiCategory: "outline", aiAction: "expand" }),
          event({ name: "Remove", v30: 1000, ai30: 1400, aiCategory: "outline", aiAction: "remove" }),
          event({ name: "Cancel", v30: 0, ai30: 50, aiCategory: "outline", aiAction: "cancel" }),
        ],
        total: 4,
      })}
      onTip={() => {}}
    />,
  );
  expect(html).toContain(">0%<");
  expect(html).not.toContain(">Shared<");
  expect(html).toContain("No Amplitude volume");
  expect(html).toContain("2 shared identities · 1 no Amplitude volume · 1 unexplained");
  expect(html).toContain('aria-label="Analyze Remove"');
  expect(html).not.toContain('aria-label="Analyze Expand"');
  expect(html).not.toContain('aria-label="Analyze Cancel"');
  const start = html.indexOf('data-group="start"');
  const end = html.indexOf('data-group="end"');
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  expect(html.slice(start, end)).toContain("Collapse");
  expect(html.slice(start, end)).not.toContain("Remove");
  expect(html.indexOf(">Collapse<")).toBeLessThan(html.indexOf(">Expand<"));
});

test("a shared group shows one summed diff and keeps zero-amplitude rows labeled", () => {
  const html = renderDetail(
    <AppDetail
      repo={repo({
        events: [
          event({
            name: "Initiate",
            v30: 149000,
            ai30: 224000,
            legacy: ["OutlineRenameNodeEventV1"],
            aiCategory: "outline",
            aiAction: "rename-node",
          }),
          event({
            name: "Confirm Rename",
            v30: 76000,
            ai30: 224000,
            legacy: ["OutlineRenameNodeEventV1"],
            aiCategory: "outline",
            aiAction: "rename-node",
          }),
          event({
            name: "Cancel Rename",
            v30: 306,
            ai30: 224000,
            legacy: ["OutlineRenameNodeEventV1"],
            aiCategory: "outline",
            aiAction: "rename-node",
          }),
          event({
            name: "Cancel",
            v30: 0,
            ai30: 224000,
            legacy: ["OutlineRenameNodeEventV1"],
            aiCategory: "outline",
            aiAction: "rename-node",
          }),
          event({
            name: "As Child",
            v30: 0,
            ai30: 224000,
            legacy: ["OutlineRenameNodeEventV1", "OutlineRearrangeNodeEventV1"],
            aiCategory: "outline",
            aiAction: "rename-node",
          }),
        ],
        total: 5,
      })}
      onTip={() => {}}
    />,
  );
  expect(html).toContain(">1%<");
  expect(html).toContain("color:var(--st-good-ink)");
  expect(html.match(/OutlineRenameNodeEventV1/g)).toHaveLength(1);
  expect(html.match(/>224K</g)).toHaveLength(1);
  expect(html).toContain(">OutlineRearrangeNodeEventV1</span>");
  expect(html.match(/No Amplitude volume/g)).toHaveLength(2);
});

test("App Intel event names each sit on their own line", () => {
  const html = renderDetail(
    <AppDetail
      repo={repo({
        events: [event({ legacy: ["OutlineAddNewNodeEventV1", "OutlineRearrangeNodeEventV1"] })],
      })}
      onTip={() => {}}
    />,
  );
  expect(html).toContain(">OutlineAddNewNodeEventV1</span>");
  expect(html).toContain(">OutlineRearrangeNodeEventV1</span>");
  expect(html).not.toContain("OutlineAddNewNodeEventV1, OutlineRearrangeNodeEventV1");
});
