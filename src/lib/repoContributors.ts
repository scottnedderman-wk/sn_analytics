import type { Database } from "bun:sqlite";

export const GITHUB_ORG = "Workiva";
export const TOP_CONTRIBUTOR_COUNT = 3;

/** Login or display-name prefixes for automation accounts that are not people. */
export const CONTRIBUTOR_EXCLUSION_PREFIXES = [
  "rmconsole",
  "rm-",
  "wk-gh",
  "sourcegraph",
  "cursor",
];

export type RepoContributor = {
  repo: string;
  rank: number;
  login: string;
  name: string;
  contributions: number;
  fetchedAt: string;
};

type GitHubContributor = {
  login?: string;
  contributions?: number;
  type?: string;
};

type GitHubUser = {
  login?: string;
  name?: string | null;
};

export function isExcludedContributor(login: string, name = ""): boolean {
  const values = [login, name]
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  return CONTRIBUTOR_EXCLUSION_PREFIXES.some((prefix) => {
    const needle = prefix.toLowerCase();
    return values.some((value) => value.startsWith(needle));
  });
}

export function pickTopContributors(
  rows: GitHubContributor[],
  limit = TOP_CONTRIBUTOR_COUNT,
): GitHubContributor[] {
  return rows
    .filter(
      (row) =>
        row.login && row.type !== "Bot" && !isExcludedContributor(row.login),
    )
    .slice(0, limit);
}

export function contributorDisplayName(
  profile: GitHubUser,
  login: string,
): string {
  const name = profile.name?.trim();
  return name || login;
}

export function parseRepoContributorArgs(argv: string[]): {
  all: boolean;
  repos: string[];
} {
  const args = argv.slice(2);
  if (args.length === 0) {
    throw new Error(
      "Usage: bun scripts/repo-contributors.ts <repo> [repo...]\n       bun scripts/repo-contributors.ts --all",
    );
  }
  if (args.includes("--all")) {
    if (args.length > 1)
      throw new Error("--all does not take repository names");
    return { all: true, repos: [] };
  }
  return { all: false, repos: args };
}

export function githubTokenFromEnv(env: {
  GITHUB_TOKEN?: string;
  GH_TOKEN?: string;
}): string | null {
  const token = env.GITHUB_TOKEN?.trim() || env.GH_TOKEN?.trim();
  return token || null;
}

export function saveRepoContributors(
  db: Database,
  repo: string,
  rows: RepoContributor[],
): void {
  const del = db.query("DELETE FROM repo_contributor WHERE repo = ?");
  const ins = db.query(
    "INSERT INTO repo_contributor (repo, rank, login, name, contributions, fetched_at) VALUES (?, ?, ?, ?, ?, ?)",
  );
  db.transaction(() => {
    del.run(repo);
    for (const row of rows) {
      ins.run(
        row.repo,
        row.rank,
        row.login,
        row.name,
        row.contributions,
        row.fetchedAt,
      );
    }
  })();
}

export function listRepoContributors(
  db: Database,
  repo: string,
): RepoContributor[] {
  const rows = db
    .query(
      "SELECT repo, rank, login, name, contributions, fetched_at FROM repo_contributor WHERE repo = ? ORDER BY rank",
    )
    .all(repo) as Array<{
    repo: string;
    rank: number;
    login: string;
    name: string;
    contributions: number;
    fetched_at: string;
  }>;
  return rows
    .map((row) => ({
      repo: row.repo,
      rank: row.rank,
      login: row.login,
      name: row.name,
      contributions: row.contributions,
      fetchedAt: row.fetched_at,
    }))
    .filter((row) => !isExcludedContributor(row.login, row.name));
}

export async function fetchTopRepoContributors(
  repo: string,
  options: {
    token: string;
    fetch?: typeof fetch;
    org?: string;
    limit?: number;
    now?: () => string;
  },
): Promise<RepoContributor[]> {
  const fetchImpl = options.fetch ?? fetch;
  const org = options.org ?? GITHUB_ORG;
  const limit = options.limit ?? TOP_CONTRIBUTOR_COUNT;
  const fetchedAt = (options.now ?? (() => new Date().toISOString()))();
  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${options.token}`,
    "User-Agent": "sn-analytics",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const listUrl = `https://api.github.com/repos/${encodeURIComponent(org)}/${encodeURIComponent(repo)}/contributors?per_page=${Math.max(limit * 3, 10)}`;
  const listRes = await fetchImpl(listUrl, { headers });
  if (!listRes.ok) {
    throw new Error(
      `GitHub contributors for ${org}/${repo} returned ${listRes.status}`,
    );
  }
  const listed = pickTopContributors(
    (await listRes.json()) as GitHubContributor[],
    limit,
  );
  const contributors: RepoContributor[] = [];
  for (const [index, row] of listed.entries()) {
    const login = row.login!;
    const userRes = await fetchImpl(
      `https://api.github.com/users/${encodeURIComponent(login)}`,
      { headers },
    );
    const profile = userRes.ok
      ? ((await userRes.json()) as GitHubUser)
      : { login };
    contributors.push({
      repo,
      rank: index + 1,
      login,
      name: contributorDisplayName(profile, login),
      contributions: row.contributions ?? 0,
      fetchedAt,
    });
  }
  return contributors;
}
