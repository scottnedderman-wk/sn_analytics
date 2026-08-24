export type SnowflakeCreds = { pat: string };

export function credsFromEnv(env: { SNOWFLAKE_PAT?: string } = process.env): SnowflakeCreds {
  const pat = env.SNOWFLAKE_PAT?.trim() ?? "";
  if (!pat) throw new Error("Set SNOWFLAKE_PAT in .env");
  return { pat };
}

export function parseArgs(argv: string[]): { app: string } {
  const positional = argv.slice(2);
  const app = positional[0]?.trim() ?? "";
  if (positional.length !== 1 || !app) {
    throw new Error("Usage: bun run snowflake-events -- <app>");
  }
  return { app };
}
