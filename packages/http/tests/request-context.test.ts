import { describe, expect, test } from "bun:test";
import { RequestContextFrozenError, RequestContextStore } from "../src/request";

describe("RequestContextStore", () => {
  test("set/get a plain value", () => {
    const store = new RequestContextStore();
    store.set("user", { id: "1" });
    expect(store.get("user")).toEqual({ id: "1" });
    expect(store.get("missing")).toBeUndefined();
  });

  test("set with an explicit generic still just stores the value", () => {
    const store = new RequestContextStore();
    store.set<{ id: string }>("tenant", { id: "t1" });
    expect(store.get("tenant")).toEqual({ id: "t1" });
  });

  test("set with a synchronous factory stores the produced value immediately", () => {
    const store = new RequestContextStore();
    store.set("user", () => ({ id: "2" }));
    expect(store.get("user")).toEqual({ id: "2" });
  });

  test("set with an async factory resolves by settle()", async () => {
    const store = new RequestContextStore();
    store.set("user", async () => ({ id: "3" }));
    expect(store.get("user")).toBeUndefined();
    const settled = await store.settle();
    expect(settled.user).toEqual({ id: "3" });
    expect(store.get("user")).toEqual({ id: "3" });
  });

  test("settle() resolves multiple pending async factories concurrently", async () => {
    const store = new RequestContextStore();
    store.set("a", async () => 1);
    store.set("b", async () => 2);
    const settled = await store.settle();
    expect(settled).toEqual({ a: 1, b: 2 });
  });

  test("settle() freezes the store and returns a frozen object", async () => {
    const store = new RequestContextStore();
    store.set("user", { id: "1" });
    const settled = await store.settle();
    expect(Object.isFrozen(settled)).toBe(true);
  });

  test("set() after settle() throws RequestContextFrozenError", async () => {
    const store = new RequestContextStore();
    await store.settle();
    expect(() => store.set("user", { id: "1" })).toThrow(RequestContextFrozenError);
  });

  test("currentView() reflects live values before settle()", () => {
    const store = new RequestContextStore();
    store.set("user", { id: "1" });
    expect(store.currentView()).toEqual({ user: { id: "1" } });
  });

  test("a function value must be wrapped in a factory to be stored as-is", () => {
    const store = new RequestContextStore();
    const callback = (): string => "hi";
    store.set("onCleanup", () => callback);
    expect(store.get("onCleanup")).toBe(callback);
  });

  test("does not leak state between independent store instances", () => {
    const a = new RequestContextStore();
    const b = new RequestContextStore();
    a.set("user", { id: "a" });
    b.set("user", { id: "b" });
    expect(a.get("user")).toEqual({ id: "a" });
    expect(b.get("user")).toEqual({ id: "b" });
  });
});
