import type { TranslationParameters, ValidationMessage } from "@warbler/i18n";
import type { AnyField, FieldOutput, InferRuleShape, RuleShape } from "./builder";

export type { AnyField, FieldOutput, InferRuleShape, RuleShape };
export type ValidationSource = "body" | "query" | "path" | "headers" | "cookies" | "message" | "metadata";
export interface ValidatorOptions { readonly asyncConcurrency?: number }
export interface ValidationInput {
  readonly value?: unknown; readonly query?: unknown; readonly path?: unknown; readonly headers?: unknown;
  readonly cookies?: unknown; readonly message?: unknown; readonly metadata?: unknown;
}
export interface ValidationIssue {
  readonly source: ValidationSource; readonly path: readonly PropertyKey[]; readonly field: string; readonly code: string; readonly message: ValidationMessage;
}
export type ValidationErrors = Readonly<Record<string, readonly ValidationIssue[]>>;
export type ValidationResult<TOutput = unknown> =
  | Readonly<{ valid: true; value: TOutput; query?: unknown; path?: unknown; headers?: unknown; cookies?: unknown; message?: unknown; metadata?: unknown }>
  | Readonly<{ valid: false; errors: ValidationErrors }>;
export type MaybePromise<T> = T | Promise<T>;
export interface ValidationRequest {
  readonly native: Request; readonly body: unknown; readonly params: Readonly<Record<string, unknown>>;
  readonly query: unknown; readonly headers: Headers; readonly cookies: Bun.CookieMap;
  readonly context: Readonly<Record<string, unknown>>; readonly locale: string;
  tr(key: string, parameters?: TranslationParameters): string;
}
export type ValidationErrorHandler = (req: ValidationRequest, errors: ValidationErrors) => MaybePromise<Response>;
export type EmptyShape = Readonly<Record<never, never>>;
type RulesOf<T, K extends PropertyKey> = K extends keyof T ? NonNullable<T[K]> extends RuleShape ? InferRuleShape<NonNullable<T[K]>> : unknown : unknown;
type BodyRuleOf<T> = "bodyRule" extends keyof T ? NonNullable<T["bodyRule"]> extends AnyField ? FieldOutput<NonNullable<T["bodyRule"]>> : unknown : never;
type PreferredRules<T, NewKey extends PropertyKey, OldKey extends PropertyKey> = NewKey extends keyof T ? RulesOf<T, NewKey> : RulesOf<T, OldKey>;
export type InferValidatorBody<T> = [BodyRuleOf<T>] extends [never] ? PreferredRules<T, "bodyRules", "rules"> : BodyRuleOf<T>;
export type InferValidatorQuery<T> = RulesOf<T, "queryRules">;
export type InferValidatorPath<T> = "paramRules" extends keyof T ? RulesOf<T, "paramRules"> : PreferredRules<T, "paramsRules", "pathRules">;
export type InferValidatorHeaders<T> = RulesOf<T, "headerRules">;
export type InferValidatorCookies<T> = RulesOf<T, "cookieRules">;
export type InferValidatorMessage<T> = RulesOf<T, "messageRules">;
export type InferValidatorMetadata<T> = RulesOf<T, "metadataRules">;
export interface ValidatorStageInput<TDefinition> {
  readonly body: InferValidatorBody<TDefinition>; readonly query: InferValidatorQuery<TDefinition>;
  readonly params: InferValidatorPath<TDefinition>; readonly path: InferValidatorPath<TDefinition>;
  readonly headers: InferValidatorHeaders<TDefinition>; readonly cookies: InferValidatorCookies<TDefinition>;
  readonly message: InferValidatorMessage<TDefinition>; readonly metadata: InferValidatorMetadata<TDefinition>;
}
export type RejectPath<TDefinition> =
  | `body.${Extract<keyof InferValidatorBody<TDefinition>, string>}` | `query.${Extract<keyof InferValidatorQuery<TDefinition>, string>}`
  | `params.${Extract<keyof InferValidatorPath<TDefinition>, string>}` | `path.${Extract<keyof InferValidatorPath<TDefinition>, string>}`
  | `headers.${Extract<keyof InferValidatorHeaders<TDefinition>, string>}` | `cookies.${Extract<keyof InferValidatorCookies<TDefinition>, string>}`
  | `message.${Extract<keyof InferValidatorMessage<TDefinition>, string>}` | `metadata.${Extract<keyof InferValidatorMetadata<TDefinition>, string>}`;
export type RejectFunction<TDefinition> = (path: RejectPath<TDefinition> | string, message: string, nestedPath?: readonly PropertyKey[]) => void;
export type AfterCallback<TDefinition> = (input: ValidatorStageInput<TDefinition>, reject: RejectFunction<TDefinition>) => MaybePromise<void>;
export type PatchOutput<TDefinition> = Partial<{
  readonly body: Readonly<Record<string, unknown>>; readonly query: Readonly<Record<string, unknown>>;
  readonly params: Readonly<Record<string, unknown>>; readonly path: Readonly<Record<string, unknown>>;
  readonly headers: Readonly<Record<string, unknown>>; readonly cookies: Readonly<Record<string, unknown>>;
  readonly message: Readonly<Record<string, unknown>>; readonly metadata: Readonly<Record<string, unknown>>;
}>;
export type PatchCallback<TDefinition> = (input: ValidatorStageInput<TDefinition>) => PatchOutput<TDefinition>;
export type MapCallback<TDefinition, TResult> = (input: ValidatorStageInput<TDefinition>) => TResult;
export interface RequestValidator<
  TRules extends RuleShape = EmptyShape, TQuery extends RuleShape = EmptyShape, TPath extends RuleShape = EmptyShape,
  THeaders extends RuleShape = EmptyShape, TCookies extends RuleShape = EmptyShape, TMessage extends RuleShape = EmptyShape,
  TMetadata extends RuleShape = EmptyShape, TBodyRule extends AnyField | undefined = undefined,
  TOutput = TBodyRule extends AnyField ? FieldOutput<TBodyRule> : InferRuleShape<TRules>,
> {
  readonly bodyRule?: TBodyRule; readonly bodyRules?: TRules; readonly queryRules?: TQuery;
  readonly paramRules?: TPath; readonly paramsRules?: TPath; readonly headerRules?: THeaders;
  readonly cookieRules?: TCookies; readonly messageRules?: TMessage; readonly metadataRules?: TMetadata;
  readonly mapV?: (value: InferRuleShape<TRules>) => TOutput; readonly mapK?: Readonly<Record<string, string>>;
  readonly onValidationError?: ValidationErrorHandler; readonly csrf?: boolean;
  /** @deprecated use `bodyRules` */ readonly rules?: TRules;
  /** @deprecated use `paramRules` */ readonly pathRules?: TPath;
}
export interface CompiledValidator<TOutput = unknown> {
  readonly id: number; readonly flags: number; readonly onValidationError?: ValidationErrorHandler;
  execute(input: ValidationInput): MaybePromise<ValidationResult<TOutput>>;
}
type MapValueOutput<T> = "mapV" extends keyof T ? NonNullable<T["mapV"]> extends (...input: any[]) => infer O ? O : InferValidatorBody<T> : InferValidatorBody<T>;
type MapRecord<T> = "mapK" extends keyof T ? NonNullable<T["mapK"]> extends Readonly<Record<string, string>> ? NonNullable<T["mapK"]> : {} : {};
type MapTargets<M> = M[keyof M] & string;
type RenameKeys<T, M extends Readonly<Record<string, string>>> = T extends Readonly<Record<string, unknown>> ? Omit<T, Extract<keyof M, keyof T>> & { readonly [K in MapTargets<M>]: T[Extract<{ [S in keyof M]: M[S] extends K ? S : never }[keyof M], keyof T>] } : T;
type StageMapOutput<T> = "__warblerMap" extends keyof T ? NonNullable<T["__warblerMap"]> extends () => infer TMapped ? TMapped : never : never;
type DefinitionBodyOutput<T> = "__warblerOutput" extends keyof T ? NonNullable<T["__warblerOutput"]> extends () => infer TMapped ? TMapped : never : never;
type DefinitionKeyMap<T> = "__warblerKeyMap" extends keyof T ? NonNullable<T["__warblerKeyMap"]> extends () => infer TKeyMap ? TKeyMap extends Readonly<Record<string, string>> ? TKeyMap : EmptyShape : EmptyShape : EmptyShape;
export type InferValidatorOutput<T> = [StageMapOutput<T>] extends [never] ? [DefinitionBodyOutput<T>] extends [never] ? RenameKeys<MapValueOutput<T>, MapRecord<T>> : RenameKeys<DefinitionBodyOutput<T>, DefinitionKeyMap<T>> : StageMapOutput<T>;
export type ValidationTranslator = (key: string, parameters?: TranslationParameters) => string;
