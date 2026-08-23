import { defineHandler } from "@warbler/core";
import { defineValidator, v } from "@warbler/validators";
import { defineHttpGraph, defineHttpRoute, type HttpGraphRoute, type HttpRouteKey, type HttpRouteTable } from "../src";

const handler = defineHandler({
  run: (_ctx: unknown) => undefined,
});

const acceptedRouteKey: HttpRouteKey = "GET /test";

defineHttpGraph({
  routes: {
    "GET /test": handler,
    "POST /test": { handler, name: "test.create" },
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
      },
    }),
  },
});

const missingPathParamValidator = defineValidator({ paramRules: {} });
const extraPathParamValidator = defineValidator({ paramRules: { id: v.uuid(), tenantId: v.uuid() } });

defineHttpGraph({
  routes: {
    // @ts-expect-error validator params must cover every path parameter
    "GET /missing/:id": defineHttpRoute({
      validator: missingPathParamValidator,
      run(ctx) { return ctx.params; },
    }),
    // @ts-expect-error validator params must not include params absent from the path
    "GET /extra/:id": defineHttpRoute({
      validator: extraPathParamValidator,
      run(ctx) { return ctx.params.id; },
    }),
  },
});
