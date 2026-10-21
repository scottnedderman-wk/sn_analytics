#!/usr/bin/env bun
import { seedJsonUrl } from "../src/lib/dataPath";
import { openAppDatabase, sqlitePathFromEnv } from "../src/lib/db";
import {
  fetchTopRepoContributors,
  githubTokenFromEnv,
  parseRepoContributorArgs,
  saveRepoContributors,
} from "../src/lib/repoContributors";
import type { SeedData } from "../src/lib/seed";

async function tokenFromGh(): Promise<string | null> {
  const env = { ...process.env };
  delete env.GITHUB_TOKEN;
  delete env.GH_TOKEN;
  const proc = Bun.spawn(["gh", "auth", "token"], { stdout: "pipe", stderr: "pipe", env });
  const out = (await new Response(proc.stdout).text()).trim();
  const code = await proc.exited;
  if (code !== 0 || !out) return null;
  return out;
}

function canRetryWithAnotherToken(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /returned (401|403|404)/.test(message);
}

async function repoNames(): Promise<string[]> {
  const parsed = parseRepoContributorArgs(Bun.argv);
  if (!parsed.all) return parsed.repos;
  const seed = (await Bun.file(seedJsonUrl).json()) as SeedData;
  return seed.repos.map((repo) => repo.repo);
}

try {
  const repos = await repoNames();
  const envToken = githubTokenFromEnv(process.env);
  const ghToken = await tokenFromGh();
  const tokens = [...new Set([envToken, ghToken].filter((token): token is string => !!token))];
  if (tokens.length === 0) {
    throw new Error("Set GITHUB_TOKEN or sign in with gh auth login");
  }
  const db = openAppDatabase(sqlitePathFromEnv());
  let failed = 0;
  for (const repo of repos) {
    try {
      let rows = null;
      let lastError: unknown = null;
      for (const token of tokens) {
        try {
          rows = await fetchTopRepoContributors(repo, { token });
          break;
        } catch (err) {
          lastError = err;
          if (!canRetryWithAnotherToken(err)) break;
        }
      }
      if (!rows) throw lastError;
      saveRepoContributors(db, repo, rows);
      console.log(repo);
      if (rows.length === 0) {
        console.log("  no contributors");
        continue;
      }
      for (const row of rows) {
        const who = row.name === row.login ? row.login : `${row.name} (${row.login})`;
        console.log(`  ${row.rank}. ${who} · ${row.contributions}`);
      }
    } catch (err) {
      failed += 1;
      console.error(`${repo}: ${err instanceof Error ? err.message : err}`);
    }
  }
  db.close();
  if (failed > 0) process.exit(1);
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
