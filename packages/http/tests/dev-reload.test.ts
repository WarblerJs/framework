import { describe, expect, test } from "bun:test";
import { HttpDevReloader } from "../src/server";

describe("development reload", () => {
  test("debounces bursts and ignores equal routes", async () => {
    let compiles = 0;
    let reloads = 0;
    const initial = Object.freeze({ "/": new Response("ok") });
    const server = { reload() { reloads++; } };
    const equal = new HttpDevReloader(server, initial, () => { compiles++; return initial; }, 1);
    equal.schedule();
    equal.schedule();
    equal.schedule();
    await Bun.sleep(10);
    expect(compiles).toBe(1);
    expect(reloads).toBe(0);
    const changed = new HttpDevReloader(server, initial, () => ({ "/next": new Response("next") }), 1);
    changed.schedule();
    await Bun.sleep(10);
    expect(reloads).toBe(1);
  });
});
