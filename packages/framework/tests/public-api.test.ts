import { describe, expect, test } from "bun:test";
import {
  defineHttpGraph,
  defineValidator,
  JsonRes,
  Provider,
  Service,
  v,
  type AppRequest,
  type Guard,
  type HandlerObject,
  type Middleware,
} from "../src";

describe("@warblerjs/framework public facade", () => {
  test("re-exports stable application-facing HTTP, handler, validator, and DI APIs", async () => {
    const validator = defineValidator({
      queryRules: {
        id: v.number().int(),
      },
    });
    @Service()
    class GetUserUseCase {
      execute(id: number): number { return id + 1; }
    }
    const guard: Guard<AppRequest<typeof validator>> = (request) => request.query.id > 0;
    const middleware: Middleware<AppRequest<typeof validator>> = (_request, _context, next) => next();
    const handler = {
      useCase: {
        getUser: GetUserUseCase,
      },
      validator,
      guards: [guard],
      middlewares: [middleware],
      run(request: AppRequest<typeof validator>, { getUser }) {
        const id: number = request.query.id;
        return JsonRes({ id: getUser.execute(id) });
      },
    } satisfies HandlerObject<AppRequest<typeof validator>, { readonly getUser: typeof GetUserUseCase }>;
    const graph = defineHttpGraph({
      providers: [
        Provider({ provide: GetUserUseCase, useClass: GetUserUseCase }),
      ],
      routes: {
        "GET /users": {
          name: "users.show",
          handler,
        },
      },
    });
    expect(graph.routes["GET /users"]?.name).toBe("users.show");
    expect((await JsonRes({ ok: true }).json())).toEqual({ ok: true });
  });
});
