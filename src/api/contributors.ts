import type { Database } from "bun:sqlite";
import { listRepoContributors } from "@/lib/repoContributors";

function decodeRouteParam(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function contributorsGetResponse(db: Database, repo: string) {
  return { contributors: listRepoContributors(db, repo) };
}

export function contributorsRoutes(db: Database) {
  return {
    "/api/repos/:repo/contributors": {
      GET(req: { params: { repo: string } }) {
        return Response.json(contributorsGetResponse(db, decodeRouteParam(req.params.repo)));
      },
    },
  };
}
