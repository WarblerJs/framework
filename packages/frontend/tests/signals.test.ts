import { expect, test } from "bun:test";
import { computed, effect, signal } from "../src/signals";

test("effects reconcile dynamic dependencies and detach completely when stopped", () => {
  const useA = signal(true);
  const a = signal(1);
  const b = signal(2);
  let executions = 0;
  const stop = effect(() => { executions++; if (useA()) a(); else b(); });
  expect(executions).toBe(1);
  useA.set(false);
  expect(executions).toBe(2);
  a.set(3);
  expect(executions).toBe(2);
  b.set(4);
  expect(executions).toBe(3);
  stop(); stop();
  useA.set(true); a.set(5); b.set(6);
  expect(executions).toBe(3);
});

test("computed values notify effects and dispose their source subscriptions", () => {
  const source = signal(2);
  const doubled = computed(() => source() * 2);
  let value = 0;
  const stop = effect(() => { value = doubled(); });
  expect(value).toBe(4);
  source.set(3);
  expect(value).toBe(6);
  stop(); doubled.dispose(); doubled.dispose();
  source.set(4);
  expect(value).toBe(6);
});
