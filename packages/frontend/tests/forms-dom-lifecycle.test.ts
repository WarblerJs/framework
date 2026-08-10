import { afterEach, expect, test } from "bun:test";
import { FormBuilder } from "../src/forms";

class FakeElement extends EventTarget {
  readonly attributes = new Map<string, string>();
  readonly children: FakeElement[] = [];
  textContent = "";
  value = "";
  checked = false;
  required = false;
  minLength = -1;
  maxLength = -1;
  min = "";
  max = "";
  pattern = "";
  type = "text";
  validationMessage = "";
  valueAsNumber = Number.NaN;
  constructor(readonly tagName: string) { super(); }
  get id(): string { return this.getAttribute("id") ?? ""; }
  set id(value: string) { this.setAttribute("id", value); }
  get name(): string { return this.getAttribute("name") ?? ""; }
  get className(): string { return this.getAttribute("class") ?? ""; }
  setAttribute(name: string, value: string): void { this.attributes.set(name, value); if (name === "type") this.type = value; if (name === "required") this.required = true; }
  getAttribute(name: string): string | null { return this.attributes.get(name) ?? null; }
  hasAttribute(name: string): boolean { return this.attributes.has(name); }
  removeAttribute(name: string): void { this.attributes.delete(name); if (name === "required") this.required = false; }
  append(...items: FakeElement[]): void { this.children.push(...items); }
  querySelectorAll<T>(_selector: string): T[] { return this.children.filter((item) => item.hasAttribute("data-wbr-error-for")) as T[]; }
  querySelector<T>(selector: string): T | null {
    return (selector === "[data-wbr-form-errors]"
      ? this.children.find((item) => item.hasAttribute("data-wbr-form-errors")) ?? null
      : null) as T | null;
  }
  setCustomValidity(message: string): void { this.validationMessage = message; }
  checkValidity(): boolean { return !(this.required && this.value.length === 0); }
}

class FakeForm extends FakeElement {
  readonly elements: FakeElement[] = [];
  constructor() { super("FORM"); }
  add(element: FakeElement): void { this.elements.push(element); this.append(element); }
  reportValidity(): boolean { return this.elements.every((element) => element.checkValidity()); }
}

class FakeDocument {
  constructor(readonly form: FakeForm) {}
  getElementById(id: string): FakeForm | null { return this.form.id === id ? this.form : null; }
}

const originalDocument = globalThis.document;
const originalLocation = globalThis.location;
afterEach(() => {
  Object.defineProperty(globalThis, "document", { configurable: true, value: originalDocument });
  Object.defineProperty(globalThis, "location", { configurable: true, value: originalLocation });
});

test("destroy aborts an active fetch and a stale completion cannot invoke callbacks or restore state", async () => {
  const formElement = new FakeForm();
  formElement.id = "fetch-form";
  formElement.setAttribute("method", "post");
  const input = new FakeElement("INPUT");
  input.setAttribute("name", "email");
  formElement.add(input);
  Object.defineProperty(globalThis, "document", { configurable: true, value: new FakeDocument(formElement) });
  Object.defineProperty(globalThis, "location", { configurable: true, value: new URL("https://example.test/login") });
  const deferred = Promise.withResolvers<Response>();
  let requestSignal: AbortSignal | undefined;
  const form = FormBuilder(
    "fetch-form",
    () => ({ email: ["active@example.com"] }),
    {
      fetch: ((_input: RequestInfo | URL, init?: RequestInit) => {
        requestSignal = init?.signal ?? undefined;
        return deferred.promise;
      }) as typeof fetch,
    },
  );
  let successes = 0;
  let errors = 0;
  form.onSuccess(() => successes++);
  form.onError(() => errors++);
  formElement.dispatchEvent(new Event("submit", { cancelable: true }));
  expect(requestSignal?.aborted).toBe(false);
  expect(form.submitting()).toBe(true);
  form.destroy();
  expect(requestSignal?.aborted).toBe(true);
  expect(formElement.hasAttribute("data-wbr-submitting")).toBe(false);
  deferred.resolve(new Response("ok"));
  await deferred.promise;
  await Promise.resolve();
  expect(successes).toBe(0);
  expect(errors).toBe(0);
  expect(formElement.hasAttribute("data-wbr-submitting")).toBe(false);
});

test("reinitialization removes old listeners and old destroy cannot affect the new instance", () => {
  const formElement = new FakeForm();
  formElement.id = "login-form";
  formElement.setAttribute("class", "developer-form");
  formElement.setAttribute("data-owner", "developer");
  const input = new FakeElement("INPUT");
  input.setAttribute("name", "email");
  input.setAttribute("required", "");
  input.setAttribute("aria-describedby", "developer-help");
  formElement.add(input);
  const error = new FakeElement("SPAN");
  error.setAttribute("data-wbr-error-for", "email");
  formElement.append(error);
  Object.defineProperty(globalThis, "document", { configurable: true, value: new FakeDocument(formElement) });

  const first = FormBuilder("login-form", (v) => ({ email: ["first@example.com", v.email()] }));
  let firstInputs = 0;
  first.field("email").onInput(() => firstInputs++);
  const second = FormBuilder("login-form", (v) => ({ email: ["second@example.com", v.required()] }));
  let secondInputs = 0;
  second.field("email").onInput(() => secondInputs++);

  input.value = "next@example.com";
  input.dispatchEvent(new Event("input"));
  expect(firstInputs).toBe(0);
  expect(secondInputs).toBe(1);
  expect(() => first.patchValue({ email: "stale@example.com" })).toThrow("destroyed");
  first.destroy();
  input.dispatchEvent(new Event("input"));
  expect(secondInputs).toBe(2);

  second.destroy(); second.destroy();
  input.dispatchEvent(new Event("input"));
  expect(secondInputs).toBe(2);
  expect(formElement.className).toBe("developer-form");
  expect(formElement.getAttribute("data-owner")).toBe("developer");
  expect(input.hasAttribute("required")).toBe(true);
  expect(input.getAttribute("aria-describedby")).toBe("developer-help");
  expect(input.hasAttribute("data-wbr-valid")).toBe(false);
  expect(input.hasAttribute("data-wbr-dirty")).toBe(false);
});
