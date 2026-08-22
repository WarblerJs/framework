import { HttpMethod, type HttpMethodValue } from "./route";

export type HttpMethod = HttpMethodValue;
export type HttpRouteKey = `${HttpMethod} /${string}`;
export type HttpRouteTable<TEntry> = {
  readonly [TKey in HttpRouteKey]?: TEntry;
};
type StrictHttpRouteTable<TRoutes extends object> =
  TRoutes & Readonly<Record<Exclude<keyof TRoutes, HttpRouteKey>, never>>;

export type HttpGraphRoute<THandler = unknown> =
  | THandler
  | Readonly<{
    readonly handler: THandler;
    readonly name?: string;
    readonly middlewares?: readonly unknown[];
  }>;

export interface HttpGraphDefinition<
  TRoutes extends HttpRouteTable<HttpGraphRoute> = HttpRouteTable<HttpGraphRoute>,
> {
  readonly prefix?: string;
  readonly middlewares?: readonly unknown[];
  readonly providers?: readonly unknown[];
  readonly routes: TRoutes;
}

/** Defines a declarative HTTP graph without decorators or controller classes. */
export function defineHttpGraph<
  const TRoutes extends HttpRouteTable<HttpGraphRoute>,
  const TDefinition extends HttpGraphDefinition<TRoutes>,
>(
  definition: Omit<TDefinition, "routes"> & { readonly routes: StrictHttpRouteTable<TRoutes> },
): Readonly<Omit<TDefinition, "routes"> & { readonly routes: StrictHttpRouteTable<TRoutes> }> {
  return Object.freeze({
    ...definition,
    ...(definition.middlewares === undefined ? {} : { middlewares: Object.freeze([...definition.middlewares]) }),
    ...(definition.providers === undefined ? {} : { providers: Object.freeze([...definition.providers]) }),
    routes: Object.freeze({ ...definition.routes }),
  }) as Readonly<Omit<TDefinition, "routes"> & { readonly routes: StrictHttpRouteTable<TRoutes> }>;
}

export { HttpMethod };
