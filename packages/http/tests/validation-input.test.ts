import { expect, test } from "bun:test";
import { ValidatorSourceFlag } from "@warblerjs/validators";
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

test("prepares non-body validation input synchronously without touching body readers", () => {
  const request = new Request("http://localhost/users/10?page=2", { body: JSON.stringify({ ignored: true }), method: "POST" });
  Object.defineProperty(request, "json", { value: () => { throw new Error("body should stay lazy"); } });
  Object.defineProperty(request, "text", { value: () => { throw new Error("body should stay lazy"); } });
  Object.defineProperty(request, "formData", { value: () => { throw new Error("body should stay lazy"); } });

  const input = prepareHttpValidationInput(request, ValidatorSourceFlag.QUERY);

  expect(input).not.toBeInstanceOf(Promise);
  expect(input).toMatchObject({ query: { page: "2" }, value: undefined });
});

test("prepares body validation input asynchronously and parses the body once", async () => {
  const request = new Request("http://localhost/users", { body: JSON.stringify({ name: "Ada" }), method: "POST", headers: { "content-type": "application/json" } });
  let parses = 0;
  Object.defineProperty(request, "json", { value: async () => { parses++; return { name: "Ada" }; } });

  const input = prepareHttpValidationInput(request, ValidatorSourceFlag.BODY);

  expect(input).toBeInstanceOf(Promise);
  expect(await input).toMatchObject({ value: { name: "Ada" }, query: undefined });
  expect(parses).toBe(1);
});

test("preserves repeated urlencoded body fields as arrays", async () => {
  const request = new Request("http://localhost/users", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "tag=ts&tag=bun&name=Ada",
  });

  const input = await prepareHttpValidationInput(request, ValidatorSourceFlag.BODY);

  expect(input.value).toEqual({ tag: ["ts", "bun"], name: "Ada" });
});

test("returns binary request bodies as ArrayBuffer values", async () => {
  const request = new Request("http://localhost/upload", {
    method: "POST",
    headers: { "content-type": "application/octet-stream" },
    body: new Uint8Array([1, 2, 3]),
  });

  const input = await prepareHttpValidationInput(request, ValidatorSourceFlag.BODY);

  expect(input.value).toBeInstanceOf(ArrayBuffer);
  expect(Array.from(new Uint8Array(input.value as ArrayBuffer))).toEqual([1, 2, 3]);
});
