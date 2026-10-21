#!/usr/bin/env bun
import {
  credsFromEnv,
  eventCountsLast7d,
  formatEventCounts,
  formatSession,
  parseArgs,
  sessionInfo,
} from "../src/lib/snowflakeEvents";

try {
  parseArgs(Bun.argv);
  const creds = credsFromEnv();
  const session = await sessionInfo(creds);
  console.log(formatSession(session));
  const counts = await eventCountsLast7d(creds);
  if (counts.length > 0) console.log(formatEventCounts(counts));
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
