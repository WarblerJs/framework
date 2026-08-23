import type { TranslationParameters } from "@warbler/i18n";
import type {
  InferValidatorBody,
  InferValidatorCookies,
  InferValidatorHeaders,
  InferValidatorMessage,
  InferValidatorMetadata,
  InferValidatorOutput,
  InferValidatorPath,
  InferValidatorQuery,
  RequestValidator,
  RuleShape,
  AnyField,
} from "@warbler/validators";
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
  & Omit<RequestValidator<RuleShape, RuleShape, RuleShape, RuleShape, RuleShape, RuleShape, RuleShape, AnyField | undefined, unknown>, "mapV">
  & { readonly mapV?: (value: never) => unknown };

/**
 * `TBody` accepts either a plain body type (unchanged from before) or a validator
 * object itself (e.g. `typeof loginValidator`), in which case `body`/`params`/`query`
 * are all derived from that validator's rule sections automatically — no need to
 * write out `InferValidatorOutput<...>` or fill in every generic slot by hand.
 */
type ParamsFor<TBody> = TBody extends AnyRequestValidator
  ? (InferValidatorPath<TBody> extends Record<string, unknown> ? InferValidatorPath<TBody> : Record<string, string>)
  : Readonly<Record<never, never>>;
type QueryFor<TBody> = TBody extends AnyRequestValidator
  ? InferValidatorQuery<TBody>
  : Readonly<Record<never, never>>;
type IsUnknown<T> = unknown extends T ? keyof T extends never ? true : false : false;
type KnownOrFallback<TValue, TFallback> = IsUnknown<TValue> extends true ? TFallback : TValue;
type BodyFor<TBody> = TBody extends AnyRequestValidator ? KnownOrFallback<InferValidatorOutput<TBody>, InferValidatorBody<TBody>> : TBody;
type HeadersFor<TBody> = TBody extends AnyRequestValidator ? InferValidatorHeaders<TBody> : Readonly<Record<never, never>>;
type CookiesFor<TBody> = TBody extends AnyRequestValidator ? InferValidatorCookies<TBody> : Readonly<Record<never, never>>;
type MessageFor<TBody> = TBody extends AnyRequestValidator ? InferValidatorMessage<TBody> : Readonly<Record<never, never>>;
type MetadataFor<TBody> = TBody extends AnyRequestValidator ? InferValidatorMetadata<TBody> : Readonly<Record<never, never>>;

export interface AppRequestDevelopment {
  readonly native: Request;
}

/** Immutable request representation passed to Warbler controller handlers. */
export interface AppRequest<
  TBody = unknown,
  TParams extends Record<string, unknown> = ParamsFor<TBody>,
  TQuery = QueryFor<TBody>,
  TContext = WarblerRequestContext,
  THeaders = HeadersFor<TBody>,
  TCookies = CookiesFor<TBody>,
  TMessage = MessageFor<TBody>,
  TMetadata = MetadataFor<TBody>,
> {
  readonly dev?: AppRequestDevelopment;
  readonly body: BodyFor<TBody>;
  readonly params: Readonly<TParams>;
  readonly query: TQuery;
  readonly headers: THeaders;
  readonly cookies: TCookies;
  readonly message: TMessage;
  readonly metadata: TMetadata;
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
export type AnyAppRequest = AppRequest<unknown, Readonly<Record<never, never>>, Readonly<Record<never, never>>, unknown, unknown, unknown, unknown, unknown>;
