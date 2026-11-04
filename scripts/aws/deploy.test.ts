import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function deployExcludes(): string[] {
  const text = readFileSync(new URL("./deploy.sh", import.meta.url), "utf8");
  return [...text.matchAll(/--exclude\s+(\S+)/g)].map((match) => match[1].replace(/^['"]|['"]$/g, ""));
}

test("deploy rsync keeps src/data json and skips the local sqlite file", () => {
  const excludes = deployExcludes();
  expect(excludes).toContain("/data/*.sqlite");
  expect(excludes).not.toContain("data");

  const src = mkdtempSync(join(tmpdir(), "sn-rsync-src-"));
  const dest = mkdtempSync(join(tmpdir(), "sn-rsync-dest-"));
  try {
    mkdirSync(join(src, "data"));
    mkdirSync(join(src, "src/data"), { recursive: true });
    writeFileSync(join(src, "data/app.sqlite"), "local-db");
    writeFileSync(join(src, "src/data/aiClassIdentities.json"), "{}");
    writeFileSync(join(src, "src/index.tsx"), "export {};\n");

    const args = ["-a", "--delete"];
    for (const pattern of excludes) args.push("--exclude", pattern);
    args.push(`${src}/`, `${dest}/`);
    const ran = Bun.spawnSync(["rsync", ...args]);
    expect(ran.exitCode).toBe(0);

    expect(readFileSync(join(dest, "src/data/aiClassIdentities.json"), "utf8")).toBe("{}");
    expect(readFileSync(join(dest, "src/index.tsx"), "utf8")).toContain("export");
    expect(() => readFileSync(join(dest, "data/app.sqlite"))).toThrow();
  } finally {
    rmSync(src, { recursive: true, force: true });
    rmSync(dest, { recursive: true, force: true });
  }
});
