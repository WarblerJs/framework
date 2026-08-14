import { expect, test } from "bun:test";
import { startCaptured } from "./helpers";

interface CapturedHttp {
  readonly routes: Readonly<Record<string, Readonly<Record<string, (request: Request) => Response | Promise<Response>>>>>;
}

test("generated native HTTP routes expose the starter register route", async () => {
  let captured: CapturedHttp | undefined;
  const runtime = await startCaptured("http", (bindings) => { captured = bindings as CapturedHttp; });
  try {
    const routes = captured?.routes;
    if (routes === undefined) throw new Error("HTTP routes were not supplied");
    expect(Object.keys(routes)).toEqual(["/auth/register"]);
    expect(routes["/auth/register"]?.GET).toBeFunction();
  } finally {
    await runtime.stop();
  }
});
