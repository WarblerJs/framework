import { expect, test } from "bun:test";
import { generatedApplication } from "./helpers";

test("generated DI preserves root and Graph provider ownership", async () => {
  const application = await generatedApplication();
  const root = application.providers.filter((provider) => provider.scope === "root");
  const graph = application.providers.filter((provider) => provider.scope === "graph");
  expect(root).toHaveLength(4);
  expect(graph).toHaveLength(9);
  expect(new Set(graph.map((provider) => provider.graphId))).toEqual(new Set([0, 1, 2, 3]));
  for (const provider of root) expect(provider.graphId).toBeUndefined();
}, 15_000);
