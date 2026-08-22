import { describe, expect, test } from "bun:test";
import { Graph, GraphDefinitionError, createApp } from "../src";

describe("createApp", () => {
  test("creates an immutable app definition", () => {
    @Graph()
    class AppGraph {}
    const app = createApp({ graphs: [AppGraph] });
    expect(app.graphs).toEqual([AppGraph]);
    expect(app.transports).toEqual([]);
    expect(Object.isFrozen(app)).toBe(true);
  });

  test("stores immutable transport and graph glob declarations", () => {
    const app = createApp({ transports: ["http", "websocket"], graphs: ["src/graphs/**/*.graph.ts"] });
    expect(app.transports).toEqual(["http", "websocket"]);
    expect(app.graphs).toEqual(["src/graphs/**/*.graph.ts"]);
    expect(Object.isFrozen(app.transports)).toBe(true);
    expect(Object.isFrozen(app.graphs)).toBe(true);
  });

  test("rejects undecorated graph classes", () => {
    class InvalidGraph {}
    expect(() => createApp({ graphs: [InvalidGraph] })).toThrow(GraphDefinitionError);
  });
});
