import { expect, test } from "bun:test";
import { listenPort } from "./port";

test("defaults to 3000", () => {
  expect(listenPort({})).toBe(3000);
});

test("reads PORT", () => {
  expect(listenPort({ PORT: "80" })).toBe(80);
});
