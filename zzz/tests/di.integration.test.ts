import { expect, test } from "bun:test";
import { generatedApplication } from "./helpers";

test("generated DI preserves root and Graph provider ownership", async () => {
  const application = await generatedApplication();
  const root = application.providers.filter((provider) => provider.scope === "root");
  const graph = application.providers.filter((provider) => provider.scope === "graph");
  expect(root).toHaveLength(0);
  expect(graph).toHaveLength(0);
  expect(new Set(graph.map((provider) => provider.graphId))).toEqual(new Set());
  for (const provider of root) expect(provider.graphId).toBeUndefined();
}, 15_000);
