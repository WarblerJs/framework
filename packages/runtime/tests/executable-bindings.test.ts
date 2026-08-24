import { describe, expect, test } from "bun:test";
import { inject, type ProviderToken } from "@warblerjs/core";
import {
  createExecutableBindingsRuntime,
  type GeneratedApplicationBindings,
  type HttpRouteExecutor,
  type ProviderBindingContext,
} from "../src";

class Logger {}
class UsersService { readonly logger = inject(Logger); }
class UsersController {
  readonly users = inject(UsersService);
  list(): Response { return new Response(this.users.logger instanceof Logger ? "ok" : "invalid"); }
}

const manifest: GeneratedApplicationBindings = Object.freeze({
  application: Object.freeze({
    strings: Object.freeze([]),
    graphIds: Object.freeze({ UsersGraph: 0 }),
    providerTable: Object.freeze([
      Object.freeze({ id: 0, nameId: 0, graphId: -1, scope: "root", dependencyStart: 0, dependencyCount: 0 }),
      Object.freeze({ id: 1, nameId: 1, graphId: 0, scope: "graph", dependencyStart: 0, dependencyCount: 1 }),
    ]),
    providerDependencies: Object.freeze([0]),
    routeTable: Object.freeze([Object.freeze({ id: 0, handlerId: 0 })]),
    socketEventTable: Object.freeze([]),
  }),
  providers: Object.freeze([
    Object.freeze({ id: 0, token: Logger, scope: "root", dependencyIds: Object.freeze([]), factory: (context: ProviderBindingContext) => context.run(() => new Logger()) }),
    Object.freeze({ id: 1, token: UsersService, scope: "graph", graphId: 0, dependencyIds: Object.freeze([0]), factory: (context: ProviderBindingContext) => context.run(() => new UsersService()) }),
  ]),
  controllers: Object.freeze([
    Object.freeze({ id: 0, graphId: 0, transport: "http", token: UsersController, factory: (context: ProviderBindingContext) => context.run(() => new UsersController()) }),
  ]),
  handlers: Object.freeze([
    Object.freeze({ id: 0, controllerId: 0, invoke: (controller: UsersController) => controller.list() }),
  ]),
  guards: Object.freeze([]), middleware: Object.freeze([]), validators: Object.freeze([]),
  http: Object.freeze({
    routes: Object.freeze([Object.freeze({ id: 0 })]),
    createRoutes: (execute: HttpRouteExecutor) => Object.freeze({ "/users": Object.freeze({ GET: (request: Request) => execute(0, request) }) }),
  }),
});

describe("executable binding Runtime", () => {
  test("uses Core injection contexts and direct numeric handler dispatch", async () => {
    const runtime = createExecutableBindingsRuntime(manifest);
    expect(runtime.resolveProvider(0, 0)).toBeInstanceOf(Logger);
    expect(runtime.resolveProvider(0, 1)).toBeInstanceOf(UsersService);
    const routes = runtime.createHttpRoutes();
    expect(await (await routes["/users"]!.GET!(new Request("http://localhost/users"))).text()).toBe("ok");
    expect(runtime.controller(0)).toBe(runtime.controller(0));
  });

  test("preserves Graph isolation", () => {
    const runtime = createExecutableBindingsRuntime(manifest);
    expect(() => runtime.resolveProvider(1, 1)).toThrow();
    const token: ProviderToken<Logger> = Logger;
    expect(token).toBe(Logger);
  });
});
