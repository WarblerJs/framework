import { expect, test } from "bun:test";
import { ValidatorSourceFlag } from "@warbler/validators";
import { prepareHttpValidationInput } from "../src/request/validation-input";

test("prepared HTTP validation input keeps a fixed hot-path property shape", async () => {
  const request = new Request("http://localhost/users/10?page=2");
  Object.defineProperty(request, "params", { value: Object.freeze({ id: "10" }) });

  const input = await prepareHttpValidationInput(request, ValidatorSourceFlag.QUERY | ValidatorSourceFlag.PATH);

  expect(Object.keys(input)).toEqual(["value", "query", "path", "headers", "cookies"]);
  expect(input.value).toBeUndefined();
  expect(input.query).toEqual({ page: "2" });
  expect(input.path).toEqual({ id: "10" });
  expect(input.headers).toBeUndefined();
  expect(input.cookies).toBeUndefined();
  expect(Object.isFrozen(input)).toBe(false);
});
