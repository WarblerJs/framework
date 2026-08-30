import { expect, test } from "bun:test";
import { generatedApplication } from "./helpers";


test("generated DI preserves root and graph provider ownership", async () => {
  const application = await generatedApplication();
  const providers = application.providers;

  expect(providers).toHaveLength(3);

  expect(providers[0]).toMatchObject({
    id: 0,
    scope: "graph",
    graphId: 2,
  });

  expect(providers[1]).toMatchObject({
    id: 1,
    scope: "graph",
    graphId: 2,
  });

  expect(providers[2]).toMatchObject({
    id: 2,
    scope: "root",
  });

  expect(providers[2]!.graphId).toBeUndefined();
}, 15_000);
