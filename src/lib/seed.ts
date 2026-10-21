import { recountRepo } from "./amplitudeRefresh";
import type { DashboardData, EventStatus, MigrationEvent, RepoRecord } from "./model";

export const SEED_PROVENANCE =
  "Catalog from data/seed.json (repo, event names, identities, legacy, and status).";

export type SeedEvent = {
  name: string;
  legacy: string[];
  status: EventStatus;
  aiCategory?: string;
  aiAction?: string;
  aiEvent?: string;
  aiEventExclude?: string[];
};

export type SeedRepo = {
  repo: string;
  events: SeedEvent[];
};

export type SeedData = {
  repos: SeedRepo[];
};

function hydrateEvent(event: SeedEvent): MigrationEvent {
  return {
    name: event.name,
    legacy: event.legacy,
    status: event.status,
    v30: 0,
    v365: 0,
    dev30: 0,
    merged: false,
    pr: null,
    amp_count: null,
    ss_error: "",
    queried: 0,
    ...(event.aiCategory ? { aiCategory: event.aiCategory } : {}),
    ...(event.aiAction ? { aiAction: event.aiAction } : {}),
    ...(event.aiEvent ? { aiEvent: event.aiEvent } : {}),
    ...(event.aiEventExclude ? { aiEventExclude: event.aiEventExclude } : {}),
  };
}

function hydrateRepo(repo: SeedRepo): RepoRecord {
  const events = repo.events.map(hydrateEvent);
  return recountRepo({
    repo: repo.repo,
    events,
    counts: {},
    total: events.length,
    live: 0,
    volume30: 0,
    volume30Ai: 0,
    sources: [],
    prs: [],
    inv_mapped: 0,
    inv_unmapped: 0,
  });
}

export function hydrateSeed(seed: SeedData): DashboardData {
  return {
    provenance: SEED_PROVENANCE,
    repos: seed.repos.map(hydrateRepo),
  };
}
