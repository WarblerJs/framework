import { defineValidator, v } from "@warblerjs/validators";
import { defineHttpGraph, defineHttpRoute, type AppRequest, type HttpGraphRoute, type HttpRouteKey, type HttpRouteTable } from "../src";

const handler = () => new Response("ok");

const acceptedRouteKey: HttpRouteKey = "GET /test";

defineHttpGraph({
  routes: {
    "GET /test": handler,
    "POST /test": { handler, name: "test.create" },
  },
});

const zeroArgumentHandler = () => new Response("ok");
const asynchronousHandler = async () => new Response("ok");
const objectHandler = {
  run() {
    return new Response("ok");
  },
};
const asynchronousObjectHandler = {
  async run() {
    return new Response("ok");
  },
};
const stringHandler = () => "not a response";
const plainObjectHandler = () => ({ ok: true });
const voidHandler = () => undefined;
const missingRun = {};
const nonCallableRun = { run: "not callable" };

defineHttpGraph({
  routes: {
    "GET /zero": zeroArgumentHandler,
    "GET /async": asynchronousHandler,
    "GET /object": objectHandler,
    "GET /object-async": asynchronousObjectHandler,
    // @ts-expect-error direct functions must return Response or Promise<Response>
    "GET /string": stringHandler,
    // @ts-expect-error plain objects are not valid handler results
    "GET /plain-object": plainObjectHandler,
    // @ts-expect-error void is not a valid handler result
    "GET /void": voidHandler,
    // @ts-expect-error object handlers must expose run
    "GET /missing-run": missingRun,
    // @ts-expect-error run must be callable
    "GET /bad-run": nonCallableRun,
  },
});

const typedRoutes: HttpRouteTable<HttpGraphRoute> = {
  [acceptedRouteKey]: handler,
  // @ts-expect-error unsupported HTTP method prefix
  "GETW /test": handler,
};
const lowercaseRoutes: HttpRouteTable<HttpGraphRoute> = {
  // @ts-expect-error lowercase HTTP method prefix
  "get /test": handler,
};
const malformedRoutes: HttpRouteTable<HttpGraphRoute> = {
  // @ts-expect-error route key must include a slash-prefixed path
  "GET test": handler,
};

void typedRoutes;
void lowercaseRoutes;
void malformedRoutes;

const inlineRouteValidator = defineValidator({
  bodyRules: {
    name: v.string().min(2),
    age: v.number().int().gte(18).optional(),
    nested: v.object({ active: v.boolean() }),
    tags: v.array(v.string()),
  },
  paramRules: {
    id: v.uuid(),
  },
  queryRules: {
    include: v.string().in(["profile", "sessions"] as const).optional(),
    page: v.number().int().gte(1),
  },
  headerRules: {
    "x-tenant": v.string(),
  },
  cookieRules: {
    session: v.string().nullable(),
  },
});

const incompatibleRequest = (request: AppRequest<typeof inlineRouteValidator>) => new Response(request.body.name);

defineHttpGraph({
  routes: {
    // @ts-expect-error handler request must be compatible with the route request
    "GET /bad-request": incompatibleRequest,
  },
});

defineHttpGraph({
  routes: {
    "POST /test/:id": defineHttpRoute({
      validator: inlineRouteValidator,
      async run(ctx) {
        const id: string = ctx.params.id;
        const include: "profile" | "sessions" | undefined = ctx.query.include;
        const page: number = ctx.query.page;
        const name: string = ctx.body.name;
        const age: number | undefined = ctx.body.age;
        const active: boolean = ctx.body.nested.active;
        const tags: readonly string[] = ctx.body.tags;
        const tenant: string = ctx.headers["x-tenant"];
        const session: string | null = ctx.cookies.session;
        // @ts-expect-error undeclared path params are not exposed
        ctx.params.tenantId;
        // @ts-expect-error undeclared query keys are not exposed
        ctx.query.missing;
        // @ts-expect-error declared numeric query output is not a raw string
        const rawPage: string = ctx.query.page;
        void id; void include; void page; void name; void age; void active; void tags; void tenant; void session; void rawPage;
        return new Response("ok");
      },
    }),
  },
});

const validatedObjectHandler = {
  validator: inlineRouteValidator,
  run(ctx: AppRequest<typeof inlineRouteValidator>) {
    const id: string = ctx.params.id;
    const include: "profile" | "sessions" | undefined = ctx.query.include;
    const page: number = ctx.query.page;
    const name: string = ctx.body.name;
    const tenant: string = ctx.headers["x-tenant"];
    const session: string | null = ctx.cookies.session;
    void id; void include; void page; void name; void tenant; void session;
    return new Response("ok");
  },
};

defineHttpGraph({
  routes: {
    "POST /object/:id": { handler: validatedObjectHandler },
  },
});

const missingPathParamValidator = defineValidator({ paramRules: {} });
const extraPathParamValidator = defineValidator({ paramRules: { id: v.uuid(), tenantId: v.uuid() } });

defineHttpGraph({
  routes: {
    // @ts-expect-error validator params must cover every path parameter
    "GET /missing/:id": defineHttpRoute({
      validator: missingPathParamValidator,
      run(_ctx) { return new Response("ok"); },
    }),
    // @ts-expect-error validator params must not include params absent from the path
    "GET /extra/:id": defineHttpRoute({
      validator: extraPathParamValidator,
      run(_ctx) { return new Response("ok"); },
    }),
  },
});
