import { dataJsonUrl } from "../src/lib/dataPath";
import { seedAiIdentities } from "../src/lib/homepageVolumes";
import type { DashboardData } from "../src/lib/model";

const dataPath = dataJsonUrl;
const data = (await Bun.file(dataPath).json()) as DashboardData;
// Re-seeding replaces contract/legacy identities and removes any other identities.
await Bun.write(dataPath, JSON.stringify(seedAiIdentities(data), null, 2) + "\n");
