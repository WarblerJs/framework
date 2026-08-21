import { ValidatorError, ValidatorErrorCode } from "./errors";
import type { RuleShape, InferRuleShape, ValidationErrorHandler } from "./types";

type EmptyShape = Readonly<Record<never, never>>;

export type ValidatorDefinition<
  TRules extends RuleShape = EmptyShape,
  TQuery extends RuleShape = EmptyShape,
  TPath extends RuleShape = EmptyShape,
  THeaders extends RuleShape = EmptyShape,
  TCookies extends RuleShape = EmptyShape,
  TMessage extends RuleShape = EmptyShape,
  TMetadata extends RuleShape = EmptyShape,
  TMapped = InferRuleShape<TRules>,
  TKeyMap extends Readonly<Record<string, string>> = EmptyShape,
> = Readonly<{
  bodyRules?: TRules;
  queryRules?: TQuery;
  paramRules?: TPath;
  headerRules?: THeaders;
  cookieRules?: TCookies;
  messageRules?: TMessage;
  metadataRules?: TMetadata;
  mapV?: (value: InferRuleShape<TRules>) => TMapped;
  mapK?: TKeyMap;
  /**
   * Invoked instead of the default validation-error response when this validator's rules
   * reject a request. Receives the raw (untrusted) request and the structured validation
   * errors, and its returned `Response` is used verbatim — the controller never runs.
   * Falls back to Warbler's default validation-error response when omitted.
   */
  onValidationError?: ValidationErrorHandler;
  /** Enables existing HTTP CSRF verification for handlers using this validator. */
  csrf?: boolean;
  /** @deprecated use `bodyRules` */
  rules?: TRules;
  /** @deprecated use `paramRules` */
  pathRules?: TPath;
}>;

/**
 * Resolves a rule section that can be supplied under either its canonical name or
 * its deprecated alias. Supplying both for the same section is an ambiguous
 * definition, not a silent merge, so it throws.
 */
export function resolveAliasedSection<T>(
  newValue: T | undefined,
  oldValue: T | undefined,
  newKey: string,
  oldKey: string,
): T | undefined {
  if (newValue !== undefined && oldValue !== undefined) {
    throw new ValidatorError(
      ValidatorErrorCode.INVALID_DEFINITION,
      `Validator definition cannot specify both "${newKey}" and "${oldKey}".`,
    );
  }
  return newValue ?? oldValue;
}

/**
 * Defines a validator without widening its rule keys, Zod outputs, mapV result,
 * or mapK literals. Prefer this over a `: RequestValidator` annotation.
 */
export function defineValidator<
  const TRules extends RuleShape = EmptyShape,
  const TQuery extends RuleShape = EmptyShape,
  const TPath extends RuleShape = EmptyShape,
  const THeaders extends RuleShape = EmptyShape,
  const TCookies extends RuleShape = EmptyShape,
  const TMessage extends RuleShape = EmptyShape,
  const TMetadata extends RuleShape = EmptyShape,
  TMapped = InferRuleShape<TRules>,
  const TKeyMap extends Readonly<Record<string, string>> = EmptyShape,
>(
  definition: ValidatorDefinition<TRules, TQuery, TPath, THeaders, TCookies, TMessage, TMetadata, TMapped, TKeyMap>,
): ValidatorDefinition<TRules, TQuery, TPath, THeaders, TCookies, TMessage, TMetadata, TMapped, TKeyMap> {
  resolveAliasedSection(definition.bodyRules, definition.rules, "bodyRules", "rules");
  resolveAliasedSection(definition.paramRules, definition.pathRules, "paramRules", "pathRules");
  return Object.freeze({
    ...definition,
    ...(definition.bodyRules === undefined ? {} : { bodyRules: Object.freeze({ ...definition.bodyRules }) }),
    ...(definition.rules === undefined ? {} : { rules: Object.freeze({ ...definition.rules }) }),
    ...(definition.queryRules === undefined ? {} : { queryRules: Object.freeze({ ...definition.queryRules }) }),
    ...(definition.paramRules === undefined ? {} : { paramRules: Object.freeze({ ...definition.paramRules }) }),
    ...(definition.pathRules === undefined ? {} : { pathRules: Object.freeze({ ...definition.pathRules }) }),
    ...(definition.headerRules === undefined ? {} : { headerRules: Object.freeze({ ...definition.headerRules }) }),
    ...(definition.cookieRules === undefined ? {} : { cookieRules: Object.freeze({ ...definition.cookieRules }) }),
    ...(definition.messageRules === undefined ? {} : { messageRules: Object.freeze({ ...definition.messageRules }) }),
    ...(definition.metadataRules === undefined ? {} : { metadataRules: Object.freeze({ ...definition.metadataRules }) }),
    ...(definition.mapK === undefined ? {} : { mapK: Object.freeze({ ...definition.mapK }) }),
  });
}
