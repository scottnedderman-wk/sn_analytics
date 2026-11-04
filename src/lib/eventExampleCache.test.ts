import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openAppDatabase } from "./db";
import { cachedExampleEventNames, findEventExample, loadCachedEventSample, putEventExample } from "./eventExampleCache";
import type { EventSample } from "./eventSample";
import type { MigrationEvent } from "./model";

const sample: EventSample = {
  paired: true,
  amp: {
    eventTime: "2026-08-19 15:01:02",
    user: "user-1",
    organization: "org-1",
    workspace: "ws-1",
    duration: null,
    environment: "us",
    pageUrl: "https://app.example/a/sheet",
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
    properties: {},
  },
};

function event(): MigrationEvent {
  return {
    name: "Rename Outline Title",
    legacy: [],
    status: "live",
    v30: 0,
    v365: 0,
    dev30: 0,
    merged: false,
    pr: null,
    amp_count: null,
    ss_error: "",
    queried: 0,
  };
}

function tmpDb() {
  const dir = mkdtempSync(join(tmpdir(), "sn-analytics-"));
  return { dir, db: openAppDatabase(join(dir, "app.sqlite")) };
}

test("an example saved for one day is reused anywhere that day sits in the window", () => {
  const { dir, db } = tmpDb();
  try {
    putEventExample(db, "w_outline", "Rename Outline Title", "2026-08-19", sample, "2026-08-21T00:00:00.000Z");
    expect(findEventExample(db, "w_outline", "Rename Outline Title", { start: "2026-08-17", end: "2026-08-19" })).toEqual(sample);
    expect(findEventExample(db, "w_outline", "Rename Outline Title", { start: "2026-08-19", end: "2026-08-20" })?.ai?.duration).toBe("12");
    expect(findEventExample(db, "w_outline", "Rename Outline Title", { start: "2026-08-17", end: "2026-08-18" })).toBeNull();
    expect(cachedExampleEventNames(db, "w_outline", { start: "2026-08-17", end: "2026-08-20" })).toEqual(["Rename Outline Title"]);
    expect(cachedExampleEventNames(db, "w_outline", { start: "2026-08-17", end: "2026-08-18" })).toEqual([]);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a cached example skips the warehouse load", async () => {
  const { dir, db } = tmpDb();
  try {
    let calls = 0;
    const load = async () => {
      calls += 1;
      return sample;
    };
    const window = { start: "2026-08-17", end: "2026-08-20" };
    const first = await loadCachedEventSample(db, "w_outline", event(), window, load, () => "2026-08-21T00:00:00.000Z");
    const second = await loadCachedEventSample(db, "w_outline", event(), { start: "2026-08-18", end: "2026-08-19" }, load);
    expect(first).toEqual(sample);
    expect(second.amp?.user).toBe("user-1");
    expect(calls).toBe(1);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an example saved without property payloads is loaded again", async () => {
  const { dir, db } = tmpDb();
  try {
    const stale: EventSample = {
      ...sample,
      amp: sample.amp ? { ...sample.amp, properties: undefined as unknown as EventSample["amp"] } : null,
      ai: sample.ai,
    };
    if (stale.amp) delete (stale.amp as { properties?: unknown }).properties;
    putEventExample(db, "w_outline", "Rename Outline Title", "2026-08-19", stale, "2026-08-21T00:00:00.000Z");
    let calls = 0;
    const loaded = await loadCachedEventSample(db, "w_outline", event(), { start: "2026-08-17", end: "2026-08-19" }, async () => {
      calls += 1;
      return sample;
    });
    expect(calls).toBe(1);
    expect(loaded.amp?.properties).toEqual({ experienceName: "Outline" });
    expect(findEventExample(db, "w_outline", "Rename Outline Title", { start: "2026-08-19", end: "2026-08-19" })?.amp?.properties).toEqual({
      experienceName: "Outline",
    });
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
