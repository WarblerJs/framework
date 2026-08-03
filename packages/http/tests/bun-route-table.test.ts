import { describe, expect, test } from "bun:test";
import { createBunRoutes } from "../src/compiled";

describe("Bun route table", () => {
  test("builds native method maps and preserves handler identity", () => {
    const handler = () => new Response("ok");
    const routes = createBunRoutes([{
      prefix: "/api",
      controllers: [{
        name: "Users",
        prefix: "/users",
        routes: [{ method: "GET", path: "/:id", handler }],
      }],
    }]);
    expect(routes["/api/users/:id"]).toEqual({ GET: handler });
  });

  test("rejects duplicate method/path combinations", () => {
    const handler = () => new Response("ok");
    expect(() => createBunRoutes([{
      prefix: "",
      controllers: [{
        name: "X",
        prefix: "",
        routes: [
          { method: "GET", path: "/", handler },
          { method: "GET", path: "/", handler },
        ],
      }],
    }])).toThrow("Duplicate route");
  });
});
