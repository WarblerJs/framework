import { expect, test } from "bun:test";
import { generatedApplication } from "./helpers";

test("starter application has no generated validator-backed routes", async () => {
  const application = await generatedApplication();
  const validatorBacked = application.application.routeTable.filter((route) => validatorId(route) >= 0);
  expect(validatorBacked).toHaveLength(0);
});

function validatorId(route: unknown): number {
  if (typeof route !== "object" || route === null || !("validatorId" in route)) return -1;
  const value = route.validatorId;
  return typeof value === "number" ? value : -1;
}
