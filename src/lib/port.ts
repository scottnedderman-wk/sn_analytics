export function listenPort(env: { PORT?: string } = process.env): number {
  return Number(env.PORT ?? 3000);
}

/** Bun.serve defaults to 10s, which resets in-flight Snowflake refresh as the browser "Failed to fetch". 0 disables. */
export const SERVE_IDLE_TIMEOUT_SECONDS = 0;
