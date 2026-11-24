import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { distHandler, useDist } from "./staticDist";

let dir: string;

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "dist-"));
  writeFileSync(path.join(dir, "index.html"), "<html>index</html>");
  writeFileSync(path.join(dir, "chunk-abc.js"), "console.log(1)");
  mkdirSync(path.join(dir, "sub"));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const get = (p: string) => distHandler(dir)(new Request(`http://x${p}`));

describe("distHandler", () => {
  test("serves existing files", async () => {
    expect(await get("/chunk-abc.js").text()).toBe("console.log(1)");
  });

  test("falls back to index.html for routes, directories and traversal", async () => {
    for (const p of ["/", "/apps/foo", "/sub", "/..%2Fetc/passwd", "/../../etc/passwd"]) {
      expect(await get(p).text()).toBe("<html>index</html>");
    }
  });
});

describe("useDist", () => {
  test("requires production and a built index.html", () => {
    expect(useDist({ NODE_ENV: "production" }, dir)).toBe(true);
    expect(useDist({ NODE_ENV: "development" }, dir)).toBe(false);
    expect(useDist({ NODE_ENV: "production" }, path.join(dir, "nope"))).toBe(false);
  });
});
