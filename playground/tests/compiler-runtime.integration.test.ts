import { expect, test } from "bun:test";
import { generatedApplication } from "./helpers";

test("Compiler emits executable Playground bindings", async () => {
  const application = await generatedApplication();
  expect(Object.keys(application.application.graphIds)).toEqual(["AuthGraph", "ChatGraph", "HomeGraph", "UserGraph"]);
  expect(application.controllers).toHaveLength(4);
  expect(application.handlers).toHaveLength(23);
  expect(application.http).toBeDefined();
  expect(application.websocket).toBeDefined();
});
