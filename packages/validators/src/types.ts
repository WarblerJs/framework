import type * as z from "zod";
import type { TranslationParameters, ValidationMessage } from "@warbler/i18n";

export type RuleShape = Readonly<Record<string, z.ZodType>>;
export type ValidationSource = "body" | "query" | "path" | "headers" | "cookies" | "message" | "metadata";

export interface RequestValidator<
  TRules extends RuleShape = RuleShape,
  TQuery extends RuleShape = RuleShape,
  TPath extends RuleShape = RuleShape,
  THeaders extends RuleShape = RuleShape,
  TCookies extends RuleShape = RuleShape,
  TMessage extends RuleShape = RuleShape,
  TMetadata extends RuleShape = RuleShape,
  TMapped = InferShape<TRules>,
> {
  readonly bodyRules?: TRules;
  readonly queryRules?: TQuery;
  readonly paramRules?: TPath;
  readonly headerRules?: THeaders;
  readonly cookieRules?: TCookies;
  readonly messageRules?: TMessage;
  readonly metadataRules?: TMetadata;
  readonly mapV?: (value: InferShape<TRules>) => TMapped;
  readonly mapK?: Readonly<Record<string, string>>;
  readonly onValidationError?: ValidationErrorHandler;
  /** @deprecated use `bodyRules` */
  readonly rules?: TRules;
  /** @deprecated use `paramRules` */
  readonly pathRules?: TPath;
}

export interface ValidationInput {
  readonly value?: unknown;
  readonly query?: unknown;
  readonly path?: unknown;
  readonly headers?: unknown;
  readonly cookies?: unknown;
  readonly message?: unknown;
  readonly metadata?: unknown;
}

export interface ValidationIssue {
  readonly source: ValidationSource;
  readonly path: readonly PropertyKey[];
  readonly field: string;
  readonly code: string;
  readonly message: ValidationMessage;
}
export type ValidationErrors = Readonly<Record<string, readonly ValidationIssue[]>>;
export type ValidationResult<TOutput = unknown> =
  | Readonly<{
    valid: true; value: TOutput; query?: unknown; path?: unknown; headers?: unknown;
    cookies?: unknown; message?: unknown; metadata?: unknown;
  }>
  | Readonly<{ valid: false; errors: ValidationErrors }>;

export type MaybePromise<T> = T | Promise<T>;

/**
 * Structurally mirrors `@warbler/http`'s `AppRequest` without importing it — `@warbler/http`
 * already depends on `@warbler/validators`, so importing it back here would be circular.
 * Every field the un-validated failure path can produce a real value for is kept precisely
 * typed (`native`, `headers`, `cookies`, `context`, `locale`, `tr`); `body`/`params`/`query`
 * stay `unknown` deliberately — validation failed, so that input must never be typed as if it
 * were the successfully-validated output.
 */
export interface ValidationRequest {
  readonly native: Request;
  readonly body: unknown;
  readonly params: Readonly<Record<string, unknown>>;
  readonly query: unknown;
  readonly headers: Headers;
  readonly cookies: Bun.CookieMap;
  readonly context: Readonly<Record<string, unknown>>;
  readonly locale: string;
  tr(key: string, parameters?: TranslationParameters): string;
}

/** Invoked with the raw request and structured errors when a validator's rules reject a request. */
export type ValidationErrorHandler = (req: ValidationRequest, errors: ValidationErrors) => MaybePromise<Response>;

export interface CompiledValidator<TOutput = unknown> {
  readonly id: number;
  readonly flags: number;
  readonly bodySchema?: z.ZodType;
  readonly querySchema?: z.ZodType;
  readonly pathSchema?: z.ZodType;
  readonly headerSchema?: z.ZodType;
  readonly cookieSchema?: z.ZodType;
  readonly messageSchema?: z.ZodType;
  readonly metadataSchema?: z.ZodType;
  readonly mapValue?: (value: Readonly<Record<string, unknown>>) => unknown;
  readonly keyMap?: Readonly<Record<string, string>>;
  readonly onValidationError?: ValidationErrorHandler;
  execute(input: ValidationInput): ValidationResult<TOutput>;
}

export type InferRuleShape<T> = T extends RuleShape ? z.output<z.ZodObject<T>> : unknown;
type InferShape<T> = InferRuleShape<T>;
type RulesOf<T, K extends PropertyKey> = K extends keyof T ? NonNullable<T[K]> extends RuleShape ? InferShape<NonNullable<T[K]>> : unknown : unknown;
/** Prefers the section given under `NewKey`, falling back to the deprecated `OldKey` alias. */
type PreferredRules<T, NewKey extends PropertyKey, OldKey extends PropertyKey> =
  NewKey extends keyof T ? RulesOf<T, NewKey> : RulesOf<T, OldKey>;
type MapValueOutput<T> = "mapV" extends keyof T
  ? NonNullable<T["mapV"]> extends (...input: readonly never[]) => infer O ? O : InferValidatorBody<T>
  : InferValidatorBody<T>;
type StringKeys<T> = Extract<keyof T, string>;
type MapRecord<T> = "mapK" extends keyof T ? NonNullable<T["mapK"]> extends Readonly<Record<string, string>> ? NonNullable<T["mapK"]> : {} : {};
type MapTargets<M> = M[keyof M] & string;
type RenameKeys<T, M extends Readonly<Record<string, string>>> =
  Omit<T, Extract<keyof M, keyof T>> & { readonly [K in MapTargets<M>]: T[Extract<{ [S in keyof M]: M[S] extends K ? S : never }[keyof M], keyof T>] };

export type InferValidatorBody<T> = PreferredRules<T, "bodyRules", "rules">;
export type InferValidatorQuery<T> = RulesOf<T, "queryRules">;
export type InferValidatorPath<T> = PreferredRules<T, "paramRules", "pathRules">;
export type InferValidatorOutput<T> = RenameKeys<MapValueOutput<T>, MapRecord<T>>;
export type ValidationTranslator = (key: string, parameters?: TranslationParameters) => string;
