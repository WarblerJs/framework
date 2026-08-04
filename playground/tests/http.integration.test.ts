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
    const root = await routes["/"]!.GET!(new Request("http://127.0.0.1/"));
    expect(root.status).toBe(200);
    expect(await root.json()).toEqual({ framework: "Warbler", runtime: "Bun", status: "running" });
    const invalid = await routes["/api/auth/login"]!.POST!(new Request("http://127.0.0.1/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "", password: 4 }),
    }));
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({
      username: "Username is invalid.",
      password: "This value must be a string.",
    });
    const profileRequest = new Request("http://127.0.0.1/api/auth/profile/10");
    Object.defineProperty(profileRequest, "params", { value: Object.freeze({ id: "10" }) });
    const profile = await routes["/api/auth/profile/:id"]!.GET!(profileRequest);
    expect(profile.status).toBe(200);
    expect((await profile.json()) as Readonly<Record<string, unknown>>).toMatchObject({
      tr: "Welcome, habib!",
    });
  } finally {
    await runtime.stop();
  }
});
