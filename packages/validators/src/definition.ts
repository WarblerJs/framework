import type { RuleShape, InferRuleShape } from "./types";

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
  rules?: TRules;
  queryRules?: TQuery;
  pathRules?: TPath;
  headerRules?: THeaders;
  cookieRules?: TCookies;
  messageRules?: TMessage;
  metadataRules?: TMetadata;
  mapV?: (value: InferRuleShape<TRules>) => TMapped;
  mapK?: TKeyMap;
}>;

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
  return Object.freeze({
    ...definition,
    ...(definition.rules === undefined ? {} : { rules: Object.freeze({ ...definition.rules }) }),
    ...(definition.queryRules === undefined ? {} : { queryRules: Object.freeze({ ...definition.queryRules }) }),
    ...(definition.pathRules === undefined ? {} : { pathRules: Object.freeze({ ...definition.pathRules }) }),
    ...(definition.headerRules === undefined ? {} : { headerRules: Object.freeze({ ...definition.headerRules }) }),
    ...(definition.cookieRules === undefined ? {} : { cookieRules: Object.freeze({ ...definition.cookieRules }) }),
    ...(definition.messageRules === undefined ? {} : { messageRules: Object.freeze({ ...definition.messageRules }) }),
    ...(definition.metadataRules === undefined ? {} : { metadataRules: Object.freeze({ ...definition.metadataRules }) }),
    ...(definition.mapK === undefined ? {} : { mapK: Object.freeze({ ...definition.mapK }) }),
  });
}
