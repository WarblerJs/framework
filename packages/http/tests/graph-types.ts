import { defineHandler } from "@warbler/core";
import { defineHttpGraph, type HttpGraphRoute, type HttpRouteKey, type HttpRouteTable } from "../src";

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
