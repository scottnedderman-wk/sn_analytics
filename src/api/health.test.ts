import { describe, expect, test } from "bun:test";
import { healthRoutes } from "./health";

describe("healthRoutes", () => {
  test.each(["/_wk/ready", "/_wk/alive", "/_wk/status"] as const)("%s returns 200", async (path) => {
    const res = healthRoutes()[path]();
    expect(res.status).toBe(200);
  });
});
