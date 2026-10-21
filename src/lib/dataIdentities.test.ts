import { expect, test } from "bun:test";
import { dataJsonUrl } from "./dataPath";
import { contractFor } from "./eventCompare";
import type { DashboardData } from "./model";

test("wdesk_sdk GEL and Shell Generic Analytic carry App Intel identities", async () => {
  const data = (await Bun.file(dataJsonUrl).json()) as DashboardData;
  const sdk = data.repos.find((r) => r.repo === "wdesk_sdk")!;
  const gel = sdk.events.find((e) => e.name === "General Experience Loading")!;
  const shell = sdk.events.find((e) => e.name === "Shell Generic Analytic")!;
  expect(gel.aiCategory).toBe("general");
  expect(gel.aiAction).toBe("experience-loading");
  expect(shell.aiEventExclude).toEqual(contractFor("Shell Generic Analytic")!.aiEventExclude);
});

test("admin_client Create Workspace does not carry wdesk_sdk shell identity", async () => {
  const data = (await Bun.file(dataJsonUrl).json()) as DashboardData;
  const admin = data.repos.find((r) => r.repo === "admin_client")!;
  const createWorkspace = admin.events.find((e) => e.name === "Create Workspace")!;
  expect(createWorkspace.aiCategory).toBe("workspace");
  expect(createWorkspace.aiAction).toBe("create");
  expect(createWorkspace.aiEvent).toBeUndefined();
});
