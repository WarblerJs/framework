import type { TranslationParameters } from "@warbler/i18n";
import type { InferValidatorBody, InferValidatorPath, InferValidatorQuery, RequestValidator } from "@warbler/validators";
import type { WarblerRequestContext } from "./warbler-request-context";

/**
 * Constraint bound satisfied by every concrete validator produced by
 * `defineValidator(...)`. Bare `RequestValidator` (using its own `RuleShape`
 * defaults) can't be used directly: a concrete validator's `mapV` has a narrower
 * parameter type than the general interface's inferred one — a genuine (and here
 * harmless) contravariance mismatch. Overriding `mapV`'s parameter to `never` — the
 * bottom type, assignable to everything — makes every concrete `mapV` satisfy it.
 */
export type AnyRequestValidator =
  & Omit<RequestValidator<any, any, any, any, any, any, any, any>, "mapV">
  & { readonly mapV?: (value: never) => unknown };

/**
 * `TBody` accepts either a plain body type (unchanged from before) or a validator
 * object itself (e.g. `typeof loginValidator`), in which case `body`/`params`/`query`
 * are all derived from that validator's rule sections automatically — no need to
 * write out `InferValidatorOutput<...>` or fill in every generic slot by hand.
 */
type ParamsFor<TBody> = TBody extends AnyRequestValidator
  ? (InferValidatorPath<TBody> extends Record<string, unknown> ? InferValidatorPath<TBody> : Record<string, string>)
  : Record<string, string>;
type QueryFor<TBody> = TBody extends AnyRequestValidator
  ? InferValidatorQuery<TBody>
  : Readonly<Record<string, string | readonly string[]>>;
type BodyFor<TBody> = TBody extends AnyRequestValidator ? InferValidatorBody<TBody> : TBody;

/** Immutable request representation passed to Warbler controller handlers. */
export interface AppRequest<
  TBody = unknown,
  TParams extends Record<string, unknown> = ParamsFor<TBody>,
  TQuery = QueryFor<TBody>,
  TContext = WarblerRequestContext,
  THeaders = Headers,
  TCookies = Bun.CookieMap,
> {
  readonly native: Request;
  readonly body: BodyFor<TBody>;
  readonly params: Readonly<TParams>;
  readonly query: TQuery;
  readonly headers: THeaders;
  readonly cookies: TCookies;
  readonly context: TContext;
  readonly locale: string;
  tr(key: string, parameters?: TranslationParameters): string;
}

/**
 * The widest possible `AppRequest` instantiation — structurally satisfied by every
 * concrete `AppRequest<...>`, regardless of its validator-derived generics. Used as
 * a generic constraint bound (e.g. by `Guard`/`Middleware`) where the exact per-route
 * shape isn't known ahead of time.
 */
export type AnyAppRequest = AppRequest<unknown, Record<string, unknown>, unknown, unknown, unknown, unknown>;
