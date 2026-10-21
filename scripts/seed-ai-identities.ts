import { seedJsonUrl } from "../src/lib/dataPath";
import { seedAiIdentities } from "../src/lib/homepageVolumes";
import { hydrateSeed, type SeedData } from "../src/lib/seed";

const seed = (await Bun.file(seedJsonUrl).json()) as SeedData;
const data = seedAiIdentities(hydrateSeed(seed));
const next: SeedData = {
  repos: data.repos.map((repo) => ({
    repo: repo.repo,
    events: repo.events.map((event) => ({
      name: event.name,
      legacy: event.legacy,
      status: event.status,
      ...(event.aiCategory ? { aiCategory: event.aiCategory } : {}),
      ...(event.aiAction ? { aiAction: event.aiAction } : {}),
      ...(event.aiEvent ? { aiEvent: event.aiEvent } : {}),
      ...(event.aiEventExclude ? { aiEventExclude: event.aiEventExclude } : {}),
    })),
  })),
};
await Bun.write(seedJsonUrl, JSON.stringify(next, null, 2) + "\n");
