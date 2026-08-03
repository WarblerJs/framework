import { describe, expect, test } from "bun:test";
import { Graph, GraphDefinitionError, createApp } from "../src";

describe("createApp", () => {
  test("creates an immutable app definition", () => {
    @Graph()
    class AppGraph {}
    const app = createApp({ graphs: [AppGraph] });
    expect(app.graphs).toEqual([AppGraph]);
    expect(Object.isFrozen(app)).toBe(true);
  });

  test("rejects undecorated graph classes", () => {
    class InvalidGraph {}
    expect(() => createApp({ graphs: [InvalidGraph] })).toThrow(GraphDefinitionError);
  });
});
