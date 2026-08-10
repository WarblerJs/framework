import { expect, test } from "bun:test";
import { CleanupRegistry, InstanceRegistry, once } from "../src/forms/lifecycle";
import { isIntentionalAbort, SubmissionRequestOwner } from "../src/forms/request-owner";

test("cleanup registry destroys every resource exactly once and continues after errors", () => {
  const registry = new CleanupRegistry();
  const calls: string[] = [];
  registry.add(() => calls.push("first"));
  registry.add(() => { calls.push("broken"); throw new Error("cleanup failure"); });
  registry.add(() => calls.push("last"));
  registry.destroy(); registry.destroy();
  expect(calls).toEqual(["last", "broken", "first"]);
  registry.add(() => calls.push("late"));
  expect(calls).toEqual(["last", "broken", "first", "late"]);
});

test("individual unsubscribe cleanup is idempotent", () => {
  let calls = 0;
  const cleanup = once(() => calls++);
  cleanup(); cleanup(); cleanup();
  expect(calls).toBe(1);
});

test("reinitialization destroys the previous owner and an old destroy cannot release the new owner", () => {
  const registry = new InstanceRegistry<object, { destroyed: boolean; destroy(): void }>();
  const element = {};
  const first = registry.replace(element, () => ({ destroyed: false, destroy() { this.destroyed = true; } }));
  const second = registry.replace(element, () => ({ destroyed: false, destroy() { this.destroyed = true; } }));
  expect(first.destroyed).toBe(true);
  expect(second.destroyed).toBe(false);
  registry.release(element, first);
  expect(registry.get(element)).toBe(second);
  registry.release(element, second);
  expect(registry.get(element)).toBeUndefined();
});

test("request identity aborts replaced/destroyed requests and rejects stale completion", () => {
  const owner = new SubmissionRequestOwner();
  const first = owner.begin();
  const second = owner.begin();
  expect(first.signal.aborted).toBe(true);
  expect(owner.owns(first)).toBe(false);
  expect(owner.finish(first)).toBe(false);
  expect(owner.owns(second)).toBe(true);
  owner.destroy(); owner.destroy();
  expect(second.signal.aborted).toBe(true);
  expect(owner.owns(second)).toBe(false);
});

test("intentional abort detection does not classify ordinary failures", () => {
  expect(isIntentionalAbort(new DOMException("cancelled", "AbortError"))).toBe(true);
  expect(isIntentionalAbort(new Error("network"))).toBe(false);
});
