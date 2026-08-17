import { describe, expect, test } from "bun:test";
import { Graph, GraphDefinitionError, createApp } from "../src";

describe("createApp", () => {
  test("creates an immutable app definition", () => {
    @Graph()
    class AppGraph {}
    const app = createApp({ graphs: [AppGraph] });
    expect(app.graphs).toEqual([AppGraph]);
    expect(app.middleware).toEqual([]);
    expect(Object.isFrozen(app)).toBe(true);
  });

  test("stores immutable global middleware", () => {
    const middleware = () => undefined;
    @Graph()
    class AppGraph {}
    const app = createApp({ graphs: [AppGraph], middleware: [middleware] });
    expect(app.middleware).toEqual([middleware]);
    expect(Object.isFrozen(app.middleware)).toBe(true);
  });

  test("rejects undecorated graph classes", () => {
    class InvalidGraph {}
    expect(() => createApp({ graphs: [InvalidGraph] })).toThrow(GraphDefinitionError);
  });
});
