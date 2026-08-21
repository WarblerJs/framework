import { expect, test } from "bun:test";
import { startCaptured } from "./helpers";

interface CapturedHttp {
  readonly routes: Readonly<Record<string, Readonly<Record<string, (request: Request) => Response | Promise<Response>>>>>;
}

test("generated native HTTP routes invoke real controllers and validation", async () => {
  let captured: CapturedHttp | undefined;
  const runtime = await startCaptured("http", (bindings) => { captured = bindings as CapturedHttp; });
  try {
    const routes = captured?.routes;
    if (routes === undefined) throw new Error("HTTP routes were not supplied");
    const root = await routes["/api/test"]!.GET!(new Request("http://127.0.0.1/api/test"));
    expect(root.status).toBe(200);
    expect(await root.json()).toEqual({ success: true, method: "GET" });
    const invalid = await routes["/auth/login"]!.POST!(new Request("http://127.0.0.1/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "", password: 4 }),
    }));
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({
      email: "not_valid_email",
      password: "string",
      remember: "string",
    });
    const inherited = await routes["/users/middleware/inherited"]!.GET!(new Request("http://127.0.0.1/users/middleware/inherited"));
    expect(inherited.status).toBe(200);
    const inheritedBody = await inherited.json() as Readonly<Record<string, unknown>>;
    expect(inheritedBody.tenant).toEqual({ id: "playground", source: "default" });
    expect(inheritedBody.user).toEqual({ id: "playground-user", role: "admin" });
    expect("audit" in inheritedBody).toBe(false);
    const all = await routes["/users/middleware/all"]!.GET!(new Request("http://127.0.0.1/users/middleware/all", {
      headers: { "x-tenant-id": "acme" },
    }));
    expect(all.status).toBe(200);
    const allBody = await all.json() as Readonly<Record<string, unknown>>;
    expect(allBody.tenant).toEqual({ id: "acme", source: "header" });
    expect(allBody.user).toEqual({ id: "playground-user", role: "admin" });
    expect(allBody.audit).toEqual({ route: "users.middleware.all" });
  } finally {
    await runtime.stop();
  }
}, 15_000);
