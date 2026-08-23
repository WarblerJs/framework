import { ValidatorError, ValidatorErrorCode } from "./errors";
import type { AnyField, EmptyShape, FieldOutput, InferRuleShape, RuleShape, ValidatorOptions, AfterCallback, PatchCallback, MapCallback } from "./types";

export const VALIDATOR_STAGES: unique symbol = Symbol("warbler.validator.stages");
export interface ValidatorStages<TDefinition = unknown, TMapOutput = unknown> {
  readonly options?: ValidatorOptions;
  readonly after: readonly AfterCallback<TDefinition>[];
  readonly patch: readonly PatchCallback<TDefinition>[];
  readonly map?: MapCallback<TDefinition, TMapOutput>;
}
export type ValidatorDefinition<
  TRules extends RuleShape = EmptyShape, TQuery extends RuleShape = EmptyShape, TPath extends RuleShape = EmptyShape,
  THeaders extends RuleShape = EmptyShape, TCookies extends RuleShape = EmptyShape, TMessage extends RuleShape = EmptyShape,
  TMetadata extends RuleShape = EmptyShape, TBodyRule extends AnyField | undefined = undefined,
  TMapped = TBodyRule extends AnyField ? FieldOutput<TBodyRule> : InferRuleShape<TRules>,
  TKeyMap extends Readonly<Record<string, string>> = EmptyShape, TMapOutput = never,
  TDeclaredSections extends PropertyKey = never,
> =
  & Readonly<{
    bodyRule?: TBodyRule; bodyRules?: TRules; queryRules?: TQuery; paramRules?: TPath; paramsRules?: TPath;
    headerRules?: THeaders; cookieRules?: TCookies; messageRules?: TMessage; metadataRules?: TMetadata;
    mapV?: (value: InferRuleShape<TRules>) => TMapped; mapK?: TKeyMap;
    onValidationError?: import("./types").ValidationErrorHandler; csrf?: boolean;
    /** @deprecated use `bodyRules` */ rules?: TRules;
    /** @deprecated use `paramRules` */ pathRules?: TPath;
    readonly __warblerOutput?: () => TMapped; readonly __warblerKeyMap?: () => TKeyMap;
    readonly __warblerSections?: () => TDeclaredSections;
    readonly [VALIDATOR_STAGES]?: ValidatorStages<ValidatorDefinition<TRules, TQuery, TPath, THeaders, TCookies, TMessage, TMetadata, TBodyRule, TMapped, TKeyMap, TMapOutput, TDeclaredSections>, TMapOutput>;
    readonly __warblerMap?: TMapOutput extends never ? undefined : () => TMapOutput;
  }>
  & ValidatorStageMethods<ValidatorDefinition<TRules, TQuery, TPath, THeaders, TCookies, TMessage, TMetadata, TBodyRule, TMapped, TKeyMap, TMapOutput, TDeclaredSections>>;
export interface ValidatorStageMethods<TDefinition> {
  /** Adds sequential cross-source validation after parsed field rejectIf rules. */
  after(callback: AfterCallback<TDefinition>): TDefinition;
  /** Adds a shallow per-source patch after field value/key mapping. */
  patch(callback: PatchCallback<TDefinition>): TDefinition;
  /** Replaces the complete validation output intentionally. */
  map<TResult>(callback: MapCallback<TDefinition, TResult>): TDefinition & Readonly<{ readonly __warblerMap?: () => TResult }>;
}
type ShapeFrom<TDefinition, TKey extends PropertyKey> = TKey extends keyof TDefinition ? NonNullable<TDefinition[TKey]> extends RuleShape ? NonNullable<TDefinition[TKey]> : EmptyShape : EmptyShape;
type BodyRulesFrom<TDefinition> = "bodyRules" extends keyof TDefinition ? ShapeFrom<TDefinition, "bodyRules"> : ShapeFrom<TDefinition, "rules">;
type PathRulesFrom<TDefinition> = "paramRules" extends keyof TDefinition ? ShapeFrom<TDefinition, "paramRules"> : "paramsRules" extends keyof TDefinition ? ShapeFrom<TDefinition, "paramsRules"> : ShapeFrom<TDefinition, "pathRules">;
type BodyRuleFrom<TDefinition> = "bodyRule" extends keyof TDefinition ? NonNullable<TDefinition["bodyRule"]> extends AnyField ? NonNullable<TDefinition["bodyRule"]> : undefined : undefined;
type KeyMapFrom<TDefinition> = "mapK" extends keyof TDefinition ? NonNullable<TDefinition["mapK"]> extends Readonly<Record<string, string>> ? NonNullable<TDefinition["mapK"]> : EmptyShape : EmptyShape;
type BaseBodyOutput<TRules extends RuleShape, TBodyRule extends AnyField | undefined> = TBodyRule extends AnyField ? FieldOutput<TBodyRule> : InferRuleShape<TRules>;
type MapValueFrom<TDefinition, TRules extends RuleShape, TBodyRule extends AnyField | undefined> = "mapV" extends keyof TDefinition ? NonNullable<TDefinition["mapV"]> extends (...input: never[]) => infer TResult ? TResult : BaseBodyOutput<TRules, TBodyRule> : BaseBodyOutput<TRules, TBodyRule>;
type DeclaredSectionsFrom<TDefinition> = Extract<keyof TDefinition, "bodyRule" | "bodyRules" | "rules" | "queryRules" | "paramRules" | "paramsRules" | "pathRules" | "headerRules" | "cookieRules" | "messageRules" | "metadataRules">;

export function resolveAliasedSection<T>(newValue: T | undefined, oldValue: T | undefined, newKey: string, oldKey: string): T | undefined {
  if (newValue !== undefined && oldValue !== undefined) throw new ValidatorError(ValidatorErrorCode.INVALID_DEFINITION, `Validator definition cannot specify both "${newKey}" and "${oldKey}".`);
  return newValue ?? oldValue;
}
export function defineValidator<const TDefinition extends object>(
  definition: TDefinition,
  options: ValidatorOptions = Object.freeze({}),
): ValidatorDefinition<
  BodyRulesFrom<TDefinition>, ShapeFrom<TDefinition, "queryRules">, PathRulesFrom<TDefinition>, ShapeFrom<TDefinition, "headerRules">,
  ShapeFrom<TDefinition, "cookieRules">, ShapeFrom<TDefinition, "messageRules">, ShapeFrom<TDefinition, "metadataRules">,
  BodyRuleFrom<TDefinition>, MapValueFrom<TDefinition, BodyRulesFrom<TDefinition>, BodyRuleFrom<TDefinition>>, KeyMapFrom<TDefinition>, never, DeclaredSectionsFrom<TDefinition>
> {
  validateOptions(options);
  const runtime = definition as Readonly<Record<string, unknown>>;
  resolveAliasedSection(runtime.bodyRules, runtime.rules, "bodyRules", "rules");
  const pathCount = (runtime.paramRules === undefined ? 0 : 1) + (runtime.paramsRules === undefined ? 0 : 1) + (runtime.pathRules === undefined ? 0 : 1);
  if (pathCount > 1) throw new ValidatorError(ValidatorErrorCode.INVALID_DEFINITION, "Validator definition cannot specify more than one of \"paramRules\", \"paramsRules\", or \"pathRules\".");
  if (runtime.bodyRule !== undefined && (runtime.bodyRules !== undefined || runtime.rules !== undefined)) throw new ValidatorError(ValidatorErrorCode.INVALID_DEFINITION, "Validator definition cannot specify both bodyRule and bodyRules/rules.");
  return attachStages(freezeDefinition(definition as Readonly<Record<string, unknown>>), Object.freeze({
    ...(Object.keys(options).length === 0 ? {} : { options: Object.freeze({ ...options }) }),
    after: Object.freeze([]), patch: Object.freeze([]),
  })) as unknown as ValidatorDefinition<
    BodyRulesFrom<TDefinition>, ShapeFrom<TDefinition, "queryRules">, PathRulesFrom<TDefinition>, ShapeFrom<TDefinition, "headerRules">,
    ShapeFrom<TDefinition, "cookieRules">, ShapeFrom<TDefinition, "messageRules">, ShapeFrom<TDefinition, "metadataRules">,
    BodyRuleFrom<TDefinition>, MapValueFrom<TDefinition, BodyRulesFrom<TDefinition>, BodyRuleFrom<TDefinition>>, KeyMapFrom<TDefinition>, never, DeclaredSectionsFrom<TDefinition>
  >;
}
function freezeDefinition<TDefinition extends Readonly<Record<string, unknown>>>(definition: TDefinition): TDefinition {
  return Object.freeze({
    ...definition,
    ...(definition.bodyRules === undefined ? {} : { bodyRules: Object.freeze({ ...definition.bodyRules }) }),
    ...(definition.rules === undefined ? {} : { rules: Object.freeze({ ...definition.rules }) }),
    ...(definition.queryRules === undefined ? {} : { queryRules: Object.freeze({ ...definition.queryRules }) }),
    ...(definition.paramRules === undefined ? {} : { paramRules: Object.freeze({ ...definition.paramRules }) }),
    ...(definition.paramsRules === undefined ? {} : { paramsRules: Object.freeze({ ...definition.paramsRules }) }),
    ...(definition.pathRules === undefined ? {} : { pathRules: Object.freeze({ ...definition.pathRules }) }),
    ...(definition.headerRules === undefined ? {} : { headerRules: Object.freeze({ ...definition.headerRules }) }),
    ...(definition.cookieRules === undefined ? {} : { cookieRules: Object.freeze({ ...definition.cookieRules }) }),
    ...(definition.messageRules === undefined ? {} : { messageRules: Object.freeze({ ...definition.messageRules }) }),
    ...(definition.metadataRules === undefined ? {} : { metadataRules: Object.freeze({ ...definition.metadataRules }) }),
    ...(definition.mapK === undefined ? {} : { mapK: Object.freeze({ ...definition.mapK }) }),
  }) as TDefinition;
}
function attachStages<TDefinition extends Readonly<Record<string, unknown>>, TMapOutput>(definition: TDefinition, stages: ValidatorStages<TDefinition, TMapOutput>): TDefinition & ValidatorStageMethods<TDefinition> {
  return Object.freeze({
    ...definition,
    [VALIDATOR_STAGES]: stages,
    after(callback: AfterCallback<TDefinition>): TDefinition {
      if (typeof callback !== "function") throw new ValidatorError(ValidatorErrorCode.INVALID_DEFINITION, "after callback must be a function.");
      return attachStages(definition, Object.freeze({ ...(stages.options === undefined ? {} : { options: stages.options }), after: Object.freeze([...stages.after, callback]), patch: stages.patch, ...(stages.map === undefined ? {} : { map: stages.map }) })) as TDefinition;
    },
    patch(callback: PatchCallback<TDefinition>): TDefinition {
      if (typeof callback !== "function") throw new ValidatorError(ValidatorErrorCode.INVALID_DEFINITION, "patch callback must be a function.");
      return attachStages(definition, Object.freeze({ ...(stages.options === undefined ? {} : { options: stages.options }), after: stages.after, patch: Object.freeze([...stages.patch, callback]), ...(stages.map === undefined ? {} : { map: stages.map }) })) as TDefinition;
    },
    map<TResult>(callback: MapCallback<TDefinition, TResult>): TDefinition & Readonly<{ readonly __warblerMap?: () => TResult }> {
      if (typeof callback !== "function") throw new ValidatorError(ValidatorErrorCode.INVALID_DEFINITION, "map callback must be a function.");
      return attachStages(definition, Object.freeze({ ...(stages.options === undefined ? {} : { options: stages.options }), after: stages.after, patch: stages.patch, map: callback as MapCallback<TDefinition, unknown> })) as TDefinition & Readonly<{ readonly __warblerMap?: () => TResult }>;
    },
  }) as TDefinition & ValidatorStageMethods<TDefinition>;
}
export function validatorStages(value: unknown): ValidatorStages | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  return (value as { readonly [VALIDATOR_STAGES]?: ValidatorStages })[VALIDATOR_STAGES];
}
export function validateOptions(options: ValidatorOptions): void {
  if (options.asyncConcurrency === undefined) return;
  const value = options.asyncConcurrency;
  if (!Number.isInteger(value) || !Number.isFinite(value) || value <= 0 || value > 1024) throw new ValidatorError(ValidatorErrorCode.INVALID_CONCURRENCY, "Validation asyncConcurrency must be an integer between 1 and 1024.");
}
