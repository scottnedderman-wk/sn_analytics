#!/usr/bin/env bun
import { dataJsonUrl } from "../src/lib/dataPath";
import { credsFromEnv, refreshProduction30d, type DashboardData } from "../src/lib/amplitudeRefresh";

const dataPath = dataJsonUrl;

const data = (await Bun.file(dataPath).json()) as DashboardData;
const before = data.repos.reduce((s, r) => s + (r.counts.live || 0), 0);

const updated = await refreshProduction30d(data, credsFromEnv());
await Bun.write(dataPath, JSON.stringify(updated, null, 2) + "\n");

const after = updated.repos.reduce((s, r) => s + (r.counts.live || 0), 0);
const mapped = updated.repos.reduce((s, r) => s + r.total, 0);
console.log(
  `Wrote ${dataPath.pathname}\nLive: ${before} → ${after} of ${mapped} mapped events (as of ${updated.volumeAsOf})`,
);
