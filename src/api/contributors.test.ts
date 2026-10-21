import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openAppDatabase } from "@/lib/db";
import { saveRepoContributors } from "@/lib/repoContributors";
import { contributorsGetResponse } from "./contributors";

test("contributorsGetResponse returns the stored names in rank order", () => {
  const dir = mkdtempSync(join(tmpdir(), "sn-analytics-"));
  const db = openAppDatabase(join(dir, "app.sqlite"));
  try {
    saveRepoContributors(db, "w_outline", [
      { repo: "w_outline", rank: 1, login: "ada", name: "Ada Lovelace", contributions: 10, fetchedAt: "2026-10-21T00:00:00.000Z" },
      { repo: "w_outline", rank: 2, login: "grace", name: "Grace Hopper", contributions: 8, fetchedAt: "2026-10-21T00:00:00.000Z" },
    ]);
    expect(contributorsGetResponse(db, "w_outline").contributors.map((row) => row.name)).toEqual([
      "Ada Lovelace",
      "Grace Hopper",
    ]);
    expect(contributorsGetResponse(db, "home").contributors).toEqual([]);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
