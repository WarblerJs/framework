import { describe, expect, test } from "bun:test";
import { createHttpServerOwner, ServerState } from "../src/server";
import type { HttpNativeServerFactory } from "../src/native";

describe("HTTP server owner", () => {
  test("owns idempotency-safe start and stop", async () => {
    let stops = 0;
    const factory: HttpNativeServerFactory = () => Object.assign(Object.create(null), {
      stop() { stops++; return Promise.resolve(); },
    });
    const owner = createHttpServerOwner({
      hostname: "127.0.0.1", port: 3000, development: false, reusePort: false,
      maxRequestBodySize: 1024, routes: {},
    }, factory);
    expect(owner.state).toBe(ServerState.CREATED);
    owner.start();
    owner.start();
    expect(owner.state).toBe(ServerState.RUNNING);
    await owner.stop();
    await owner.stop();
    expect(stops).toBe(1);
    expect(owner.state).toBe(ServerState.STOPPED);
  });
});
