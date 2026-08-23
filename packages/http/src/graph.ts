import type { MaybePromise, ResolvedUseCases, UseCaseMap } from "@warbler/core";
import type {
  InferValidatorPath,
} from "@warbler/validators";
import { HttpMethod, type HttpMethodValue } from "./route";
import type { AnyRequestValidator, AppRequest } from "./request";

export type HttpMethod = HttpMethodValue;
export type HttpRouteKey = `${HttpMethod} /${string}`;
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
type InlineRouteRun<TKey extends string, TValidator, TUseCase extends UseCaseMap | undefined, TResult = unknown> =
  TUseCase extends UseCaseMap
    ? (context: RouteRequestFor<TKey, TValidator>, useCases: ResolvedUseCases<TUseCase>) => MaybePromise<TResult>
    : (context: RouteRequestFor<TKey, TValidator>) => MaybePromise<TResult>;
type ValidatorOnlyRun<TValidator, TUseCase extends UseCaseMap | undefined, TResult = unknown> =
  TUseCase extends UseCaseMap
    ? (context: TValidator extends AnyRequestValidator ? AppRequest<TValidator> : AppRequest<EmptyRequestSection, EmptyRequestSection, EmptyRequestSection>, useCases: ResolvedUseCases<TUseCase>) => MaybePromise<TResult>
    : (context: TValidator extends AnyRequestValidator ? AppRequest<TValidator> : AppRequest<EmptyRequestSection, EmptyRequestSection, EmptyRequestSection>) => MaybePromise<TResult>;
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
    readonly middlewares?: readonly unknown[];
  }>;

export type HttpInlineGraphRoute<
  TRouteKey extends HttpRouteKey,
  TValidator extends undefined = undefined,
  TUseCase extends UseCaseMap | undefined = undefined,
  TResult = unknown,
> = Readonly<{
  readonly name?: string;
  readonly validator?: TValidator;
  readonly guards?: readonly unknown[];
  readonly middlewares?: readonly unknown[];
  readonly useCase?: TUseCase;
  readonly run: InlineRouteRun<TRouteKey, TValidator, TUseCase, TResult>;
}>;

export type DefinedHttpInlineGraphRoute<
  TValidator extends AnyRequestValidator | undefined = AnyRequestValidator | undefined,
  TUseCase extends UseCaseMap | undefined = UseCaseMap | undefined,
  TResult = unknown,
> = Readonly<{
  readonly name?: string;
  readonly validator?: TValidator;
  readonly guards?: readonly unknown[];
  readonly middlewares?: readonly unknown[];
  readonly useCase?: TUseCase;
  readonly run: ValidatorOnlyRun<TValidator, TUseCase, TResult>;
  readonly __warblerRouteValidator?: () => TValidator;
}>;
type DefineHttpRouteWithoutUseCase<TValidator extends AnyRequestValidator | undefined, TResult> = Readonly<Omit<DefinedHttpInlineGraphRoute<TValidator, undefined, TResult>, "useCase" | "run"> & {
  readonly useCase?: undefined;
  readonly run: ValidatorOnlyRun<TValidator, undefined, TResult>;
}>;
type DefineHttpRouteWithUseCase<TValidator extends AnyRequestValidator | undefined, TUseCase extends UseCaseMap, TResult> = Readonly<Omit<DefinedHttpInlineGraphRoute<TValidator, TUseCase, TResult>, "useCase" | "run"> & {
  readonly useCase: TUseCase;
  readonly run: ValidatorOnlyRun<TValidator, TUseCase, TResult>;
}>;

type TypedHttpGraphRoute<TKey extends HttpRouteKey, TEntry> =
  TEntry extends DefinedHttpInlineGraphRoute<infer TValidator, infer _TUseCase, infer _TResult>
    ? TEntry & ValidateRouteParams<TKey, TValidator>
    : TEntry;

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
  TResult,
>(
  route: DefineHttpRouteWithoutUseCase<TValidator, TResult>,
): Readonly<DefinedHttpInlineGraphRoute<TValidator, undefined, TResult>>;
export function defineHttpRoute<
  const TValidator extends AnyRequestValidator,
  const TUseCase extends UseCaseMap,
  TResult,
>(
  route: DefineHttpRouteWithUseCase<TValidator, TUseCase, TResult>,
): Readonly<DefinedHttpInlineGraphRoute<TValidator, TUseCase, TResult>>;
export function defineHttpRoute<TResult>(
  route: DefineHttpRouteWithoutUseCase<undefined, TResult>,
): Readonly<DefinedHttpInlineGraphRoute<undefined, undefined, TResult>>;
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
