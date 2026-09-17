import { seedAiIdentities } from "../src/homepageVolumes";
import type { DashboardData } from "../src/model";

const dataPath = new URL("../src/data.json", import.meta.url);
const data = (await Bun.file(dataPath).json()) as DashboardData;
// Re-seeding replaces contract/legacy identities and removes any other identities.
await Bun.write(dataPath, JSON.stringify(seedAiIdentities(data), null, 2) + "\n");
