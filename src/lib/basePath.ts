/** Normalizes a URL path prefix: "" for none, otherwise "/leading" with no trailing slash. */
export function normalizeBasePath(raw: string | undefined): string {
  const trimmed = (raw ?? "").trim().replace(/^\/+|\/+$/g, "");
  return trimmed === "" ? "" : `/${trimmed}`;
}

function readBasePathEnv(): string | undefined {
  // Bun only inlines this expression when the variable is set. Otherwise it stays as-is and
  // `process` does not exist in the browser, so a missing value must not throw.
  try {
    return process.env.BUN_PUBLIC_BASE_PATH;
  } catch {
    return undefined;
  }
}

/**
 * Prefix the app is served under (e.g. "/s/sn-analytics" behind the wk ingress).
 * Inlined into the frontend bundle at build time via bunfig's BUN_PUBLIC_* env handling.
 */
export const BASE_PATH = normalizeBasePath(readBasePathEnv());

/** Prefixes an app-absolute path (e.g. "/api/x") with the base path for fetch calls. */
export function withBase(path: string, base: string = BASE_PATH): string {
  return `${base}${path}`;
}
