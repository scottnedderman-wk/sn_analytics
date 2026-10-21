import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openAppDatabase } from "./db";
import {
  contributorDisplayName,
  fetchTopRepoContributors,
  githubTokenFromEnv,
  listRepoContributors,
  parseRepoContributorArgs,
  isExcludedContributor,
  pickTopContributors,
  saveRepoContributors,
  type RepoContributor,
} from "./repoContributors";

test("pickTopContributors skips bots and keeps the GitHub ranking", () => {
  const picked = pickTopContributors([
    { login: "dependabot[bot]", contributions: 90, type: "Bot" },
    { login: "ada", contributions: 10, type: "User" },
    { login: "grace", contributions: 8, type: "User" },
    { login: "alan", contributions: 3, type: "User" },
    { login: "linus", contributions: 1, type: "User" },
  ]);
  expect(picked.map((row) => row.login)).toEqual(["ada", "grace", "alan"]);
});

test("pickTopContributors skips logins on the bot exclusion list", () => {
  expect(isExcludedContributor("rmconsole-readonly-wk")).toBe(true);
  expect(isExcludedContributor("RMConsole-bot")).toBe(true);
  expect(isExcludedContributor("ada", "rmconsole helper")).toBe(true);
  expect(isExcludedContributor("rachaelreimanis-wk", "Rachael Reimanis")).toBe(false);
  const picked = pickTopContributors([
    { login: "rmconsole-readonly-wk", contributions: 100, type: "User" },
    { login: "rachaelreimanis-wk", contributions: 40, type: "User" },
    { login: "dominicfrost-wf", contributions: 30, type: "User" },
    { login: "ada", contributions: 20, type: "User" },
  ]);
  expect(picked.map((row) => row.login)).toEqual(["rachaelreimanis-wk", "dominicfrost-wf", "ada"]);
});

test("contributorDisplayName falls back to the login", () => {
  expect(contributorDisplayName({ name: "  Ada Lovelace  " }, "ada")).toBe("Ada Lovelace");
  expect(contributorDisplayName({ name: null }, "grace")).toBe("grace");
  expect(contributorDisplayName({ name: "  " }, "alan")).toBe("alan");
});

test("parseRepoContributorArgs accepts repo names or --all", () => {
  expect(parseRepoContributorArgs(["bun", "script", "w_outline", "wdesk_sdk"])).toEqual({
    all: false,
    repos: ["w_outline", "wdesk_sdk"],
  });
  expect(parseRepoContributorArgs(["bun", "script", "--all"])).toEqual({ all: true, repos: [] });
  expect(() => parseRepoContributorArgs(["bun", "script"])).toThrow("Usage:");
  expect(() => parseRepoContributorArgs(["bun", "script", "--all", "w_outline"])).toThrow("--all");
});

test("githubTokenFromEnv reads GITHUB_TOKEN then GH_TOKEN", () => {
  expect(githubTokenFromEnv({ GITHUB_TOKEN: " abc " })).toBe("abc");
  expect(githubTokenFromEnv({ GH_TOKEN: "gh" })).toBe("gh");
  expect(githubTokenFromEnv({})).toBeNull();
});

test("saveRepoContributors replaces the previous top contributors for that repo", () => {
  const dir = mkdtempSync(join(tmpdir(), "sn-analytics-"));
  const db = openAppDatabase(join(dir, "app.sqlite"));
  const row = (rank: number, name: string): RepoContributor => ({
    repo: "w_outline",
    rank,
    login: name.toLowerCase(),
    name,
    contributions: 10 - rank,
    fetchedAt: "2026-10-21T00:00:00.000Z",
  });
  try {
    saveRepoContributors(db, "w_outline", [row(1, "Ada"), row(2, "Grace"), row(3, "Alan")]);
    saveRepoContributors(db, "wdesk_sdk", [{ ...row(1, "Linus"), repo: "wdesk_sdk" }]);
    saveRepoContributors(db, "w_outline", [row(1, "Ada"), row(2, "Katherine")]);
    expect(listRepoContributors(db, "w_outline").map((item) => item.name)).toEqual(["Ada", "Katherine"]);
    expect(listRepoContributors(db, "wdesk_sdk").map((item) => item.name)).toEqual(["Linus"]);
    saveRepoContributors(db, "w_outline", []);
    expect(listRepoContributors(db, "w_outline")).toEqual([]);
    saveRepoContributors(db, "w_outline", [row(1, "rmconsole-readonly-wk"), row(2, "Rachael")]);
    expect(listRepoContributors(db, "w_outline").map((item) => item.name)).toEqual(["Rachael"]);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("fetchTopRepoContributors asks GitHub for the repo contributors and their names", async () => {
  const calls: string[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push(url);
    const auth = new Headers(init?.headers).get("Authorization");
    expect(auth).toBe("Bearer test-token");
    if (url.includes("/contributors")) {
      return Response.json([
        { login: "rmconsole-readonly-wk", contributions: 200, type: "User" },
        { login: "dependabot[bot]", contributions: 90, type: "Bot" },
        { login: "ada", contributions: 10, type: "User" },
        { login: "grace", contributions: 8, type: "User" },
        { login: "alan", contributions: 3, type: "User" },
        { login: "linus", contributions: 1, type: "User" },
      ]);
    }
    if (url.endsWith("/users/ada")) return Response.json({ login: "ada", name: "Ada Lovelace" });
    if (url.endsWith("/users/grace")) return Response.json({ login: "grace", name: null });
    if (url.endsWith("/users/alan")) return Response.json({ login: "alan", name: " Alan Turing " });
    return new Response("missing", { status: 404 });
  };

  const rows = await fetchTopRepoContributors("w_outline", {
    token: "test-token",
    fetch: fetchImpl,
    now: () => "2026-10-21T00:00:00.000Z",
  });

  expect(rows).toEqual([
    { repo: "w_outline", rank: 1, login: "ada", name: "Ada Lovelace", contributions: 10, fetchedAt: "2026-10-21T00:00:00.000Z" },
    { repo: "w_outline", rank: 2, login: "grace", name: "grace", contributions: 8, fetchedAt: "2026-10-21T00:00:00.000Z" },
    { repo: "w_outline", rank: 3, login: "alan", name: "Alan Turing", contributions: 3, fetchedAt: "2026-10-21T00:00:00.000Z" },
  ]);
  expect(calls[0]).toContain("/repos/Workiva/w_outline/contributors");
  expect(calls.some((url) => url.endsWith("/users/linus"))).toBe(false);
  expect(calls.some((url) => url.includes("rmconsole"))).toBe(false);
});
