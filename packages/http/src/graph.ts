import type { HandlerResult, ResolvedUseCases, UseCaseMap } from "@warblerjs/core";
import type {
  InferValidatorPath,
} from "@warblerjs/validators";
import { HttpMethod, type HttpMethodValue } from "./route";
import type { AnyRequestValidator, AppRequest } from "./request";

export type HttpMethod = HttpMethodValue;
export type HttpRouteKey = `${HttpMethod} /${string}`;
export type HttpRouteResponseKind =
  | "static"
  | "view"
  | "json"
  | "html"
  | "text";
type EmptyRequestSection = Readonly<Record<never, never>>;
type RoutePath<TKey extends string> = TKey extends `${HttpMethodValue} ${infer TPath}` ? TPath : never;
type PathParamName<TSegment extends string> = TSegment extends `:${infer TName}` ? TName extends "" ? never : TName : never;
type PathParamNames<TPath extends string> =
  string extends TPath ? string :
  TPath extends `${infer THead}/${infer TTail}` ? PathParamName<THead> | PathParamNames<TTail> : PathParamName<TPath>;
type PathParamsForRoute<TKey extends string> =
  [PathParamNames<RoutePath<TKey>>] extends [never]
    ? EmptyRequestSection
    : Readonly<{ readonly [TName in PathParamNames<RoutePath<TKey>>]: string }>;

type DeclaredValidatorSections<TValidator> =
  "__warblerSections" extends keyof TValidator
    ? NonNullable<TValidator["__warblerSections"]> extends () => infer TSections ? TSections : never
    : never;
type ValidatorHasParams<TValidator> =
  Extract<DeclaredValidatorSections<TValidator>, "paramRules" | "paramsRules" | "pathRules"> extends never ? false : true;
type RouteParamsFor<TKey extends string, TValidator> =
  TValidator extends AnyRequestValidator
    ? ValidatorHasParams<TValidator> extends true
      ? InferValidatorPath<TValidator>
      : PathParamsForRoute<TKey>
    : PathParamsForRoute<TKey>;
type RouteRequestFor<TKey extends string, TValidator> =
  TValidator extends AnyRequestValidator
    ? AppRequest<TValidator, RouteParamsFor<TKey, TValidator> extends Record<string, unknown> ? RouteParamsFor<TKey, TValidator> : EmptyRequestSection>
    : AppRequest<EmptyRequestSection, PathParamsForRoute<TKey>, EmptyRequestSection>;
type RouteUseCases<TEntry> = TEntry extends { readonly useCase: infer TUseCase }
  ? TUseCase extends UseCaseMap ? TUseCase : undefined
  : undefined;
type InlineRouteRun<TKey extends string, TValidator, TUseCase extends UseCaseMap | undefined> =
  TUseCase extends UseCaseMap
    ? (context: RouteRequestFor<TKey, TValidator>, useCases: ResolvedUseCases<TUseCase>) => HandlerResult
    : (context: RouteRequestFor<TKey, TValidator>) => HandlerResult;
type ValidatorOnlyRun<TValidator, TUseCase extends UseCaseMap | undefined> =
  TUseCase extends UseCaseMap
    ? (context: TValidator extends AnyRequestValidator ? AppRequest<TValidator> : AppRequest<EmptyRequestSection, EmptyRequestSection, EmptyRequestSection>, useCases: ResolvedUseCases<TUseCase>) => HandlerResult
    : (context: TValidator extends AnyRequestValidator ? AppRequest<TValidator> : AppRequest<EmptyRequestSection, EmptyRequestSection, EmptyRequestSection>) => HandlerResult;
type ParamKeyMismatchMessage<TKey extends string, TExpected extends string, TActual extends string> =
  Exclude<TExpected, TActual> extends infer TMissing extends string
    ? Exclude<TActual, TExpected> extends infer TExtra extends string
      ? [TMissing] extends [never]
        ? [TExtra] extends [never] ? never : `Route ${TKey} has validator params not declared by its path: ${TExtra}`
        : [TExtra] extends [never]
          ? `Route ${TKey} is missing validator params: ${TMissing}`
          : `Route ${TKey} is missing validator params: ${TMissing}; and has params not declared by its path: ${TExtra}`
      : never
    : never;
type ValidateRouteParams<TKey extends string, TValidator> =
  TValidator extends AnyRequestValidator
    ? ValidatorHasParams<TValidator> extends true
      ? ParamKeyMismatchMessage<TKey, Extract<PathParamNames<RoutePath<TKey>>, string>, Extract<keyof InferValidatorPath<TValidator>, string>> extends infer TMessage
        ? [TMessage] extends [never] ? unknown : { readonly __warblerRouteParamError: TMessage }
        : unknown
      : unknown
    : unknown;

export type HttpRouteTable<TEntry = HttpGraphRoute> = {
  readonly [TKey in HttpRouteKey]?: TEntry;
};
type StrictHttpRouteTable<TRoutes extends object> =
  TRoutes & Readonly<Record<Exclude<keyof TRoutes, HttpRouteKey>, never>>;
type TypedHttpRouteTable<TRoutes extends object> = {
  readonly [TKey in keyof TRoutes]: TKey extends HttpRouteKey
    ? TypedHttpGraphRoute<TKey, TRoutes[TKey]>
    : never;
};

export type HttpGraphRoute<THandler = unknown, TRouteKey extends HttpRouteKey = HttpRouteKey> =
  | DefinedHttpInlineGraphRoute
  | HttpInlineGraphRoute<TRouteKey>
  | THandler
  | Readonly<{
    readonly handler: THandler;
    readonly name?: string;
    readonly response?: HttpRouteResponseKind;
    readonly middlewares?: readonly unknown[];
  }>;

export type HttpInlineGraphRoute<
  TRouteKey extends HttpRouteKey,
  TValidator extends undefined = undefined,
  TUseCase extends UseCaseMap | undefined = undefined,
> = Readonly<{
  readonly name?: string;
  readonly validator?: TValidator;
  readonly guards?: readonly unknown[];
  readonly middlewares?: readonly unknown[];
  readonly response?: HttpRouteResponseKind;
  readonly useCase?: TUseCase;
  readonly run: InlineRouteRun<TRouteKey, TValidator, TUseCase>;
}>;

export type DefinedHttpInlineGraphRoute<
  TValidator extends AnyRequestValidator | undefined = AnyRequestValidator | undefined,
  TUseCase extends UseCaseMap | undefined = UseCaseMap | undefined,
> = Readonly<{
  readonly name?: string;
  readonly validator?: TValidator;
  readonly guards?: readonly unknown[];
  readonly middlewares?: readonly unknown[];
  readonly useCase?: TUseCase;
  readonly response?: HttpRouteResponseKind;
  readonly run: ValidatorOnlyRun<TValidator, TUseCase>;
  readonly __warblerRouteValidator?: () => TValidator;
}>;
type DefineHttpRouteWithoutUseCase<TValidator extends AnyRequestValidator | undefined> = Readonly<Omit<DefinedHttpInlineGraphRoute<TValidator, undefined>, "useCase" | "run"> & {
  readonly useCase?: undefined;
  readonly run: ValidatorOnlyRun<TValidator, undefined>;
}>;
type DefineHttpRouteWithUseCase<TValidator extends AnyRequestValidator | undefined, TUseCase extends UseCaseMap> = Readonly<Omit<DefinedHttpInlineGraphRoute<TValidator, TUseCase>, "useCase" | "run"> & {
  readonly useCase: TUseCase;
  readonly run: ValidatorOnlyRun<TValidator, TUseCase>;
}>;
type HandlerValidator<THandler> = THandler extends { readonly validator: infer TValidator } ? TValidator : undefined;
type HandlerUseCases<THandler> = THandler extends { readonly useCase: infer TUseCase } ? TUseCase extends UseCaseMap ? TUseCase : never : undefined;
type HandlerError<TMessage extends string> = { readonly __warblerHandlerError: TMessage };
type HandlerRun<THandler> = THandler extends { readonly run: infer TRun } ? TRun : never;
type IsCallable<TValue> = TValue extends (...args: infer _TArgs) => infer _TReturn ? true : false;
type ValidateHandlerObject<TKey extends string, THandler> =
  IsCallable<HandlerRun<THandler>> extends true
    ? HandlerUseCases<THandler> extends never
      ? HandlerError<"Handler object useCase must be a map of constructors.">
      : HandlerRun<THandler> extends InlineRouteRun<TKey, HandlerValidator<THandler>, HandlerUseCases<THandler>>
        ? ValidateRouteParams<TKey, HandlerValidator<THandler>>
        : HandlerError<"Handler object run must accept the route request type and return Response or Promise<Response>.">
    : HandlerError<"Handler object must contain a callable run property.">;
type ValidateHandlerFunction<TKey extends string, THandler> =
  THandler extends InlineRouteRun<TKey, undefined, undefined>
    ? unknown
    : HandlerError<"Handler function must accept the route request type and return Response or Promise<Response>.">;
type ValidateGraphHandler<TKey extends string, THandler> =
  IsCallable<THandler> extends true
    ? ValidateHandlerFunction<TKey, THandler>
    : THandler extends { readonly run: unknown }
      ? ValidateHandlerObject<TKey, THandler>
      : HandlerError<"Route handler must be a function or an object with a callable run property.">;

type TypedHttpGraphRoute<TKey extends HttpRouteKey, TEntry> =
  TEntry extends DefinedHttpInlineGraphRoute<infer TValidator, infer _TUseCase>
    ? TEntry & ValidateRouteParams<TKey, TValidator>
    : TEntry extends { readonly handler: infer THandler }
      ? TEntry & ValidateGraphHandler<TKey, THandler>
      : TEntry & ValidateGraphHandler<TKey, TEntry>;

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
  const TRoutes extends HttpRouteTable,
  const TDefinition extends Omit<HttpGraphDefinition<TRoutes>, "routes">,
>(
  definition: TDefinition & { readonly routes: StrictHttpRouteTable<TRoutes> & TypedHttpRouteTable<TRoutes> },
): Readonly<TDefinition & { readonly routes: StrictHttpRouteTable<TRoutes> & TypedHttpRouteTable<TRoutes> }> {
  return Object.freeze({
    ...definition,
    ...(definition.middlewares === undefined ? {} : { middlewares: Object.freeze([...definition.middlewares]) }),
    ...(definition.providers === undefined ? {} : { providers: Object.freeze([...definition.providers]) }),
    routes: Object.freeze({ ...definition.routes }),
  }) as Readonly<TDefinition & { readonly routes: StrictHttpRouteTable<TRoutes> & TypedHttpRouteTable<TRoutes> }>;
}

/** Defines a validator-aware inline HTTP route for use inside `defineHttpGraph({ routes })`.
 *
 * TypeScript cannot contextually type a function parameter from a sibling
 * `validator` property in the same object literal, so validated inline routes
 * should use this helper when they need `run(ctx)` to see validator output types.
 * The graph route key still supplies method/path and validates path-param names.
 */
export function defineHttpRoute<
  const TValidator extends AnyRequestValidator,
>(
  route: DefineHttpRouteWithoutUseCase<TValidator>,
): Readonly<DefinedHttpInlineGraphRoute<TValidator, undefined>>;
export function defineHttpRoute<
  const TValidator extends AnyRequestValidator,
  const TUseCase extends UseCaseMap,
>(
  route: DefineHttpRouteWithUseCase<TValidator, TUseCase>,
): Readonly<DefinedHttpInlineGraphRoute<TValidator, TUseCase>>;
export function defineHttpRoute(
  route: DefineHttpRouteWithoutUseCase<undefined>,
): Readonly<DefinedHttpInlineGraphRoute<undefined, undefined>>;
export function defineHttpRoute(
  route: DefinedHttpInlineGraphRoute,
): Readonly<DefinedHttpInlineGraphRoute> {
  return Object.freeze({
    ...route,
    ...(route.guards === undefined ? {} : { guards: Object.freeze([...route.guards]) }),
    ...(route.middlewares === undefined ? {} : { middlewares: Object.freeze([...route.middlewares]) }),
  });
}

export { HttpMethod };
