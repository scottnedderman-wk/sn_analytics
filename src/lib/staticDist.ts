import { existsSync, statSync } from "node:fs";
import path from "node:path";

/** Directory holding the production frontend build (see build.ts). */
export const DIST_DIR = path.resolve(import.meta.dir, "../../dist");

/** True when a production build should be served instead of bundling index.html at startup. */
export function useDist(env: { NODE_ENV?: string } = process.env, distDir: string = DIST_DIR): boolean {
  return env.NODE_ENV === "production" && existsSync(path.join(distDir, "index.html"));
}

function isFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

/** Serves built files from distDir, falling back to index.html for client-side routes. */
export function distHandler(distDir: string = DIST_DIR) {
  const root = path.resolve(distDir);
  return (req: Request): Response => {
    let pathname: string;
    try {
      pathname = decodeURIComponent(new URL(req.url).pathname);
    } catch {
      return new Response("Bad Request", { status: 400 });
    }
    const candidate = path.resolve(root, `.${pathname}`);
    if (candidate.startsWith(root + path.sep) && isFile(candidate)) {
      return new Response(Bun.file(candidate));
    }
    return new Response(Bun.file(path.join(root, "index.html")));
  };
}
