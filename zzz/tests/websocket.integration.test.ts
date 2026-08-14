import { expect, test } from "bun:test";
import { generatedApplication } from "./helpers";

test("starter application does not generate WebSocket bindings", async () => {
  const application = await generatedApplication();
  expect(application.websocket).toBeUndefined();
});
