import type { Constructor } from "../types";

export type MaybePromise<T> = T | Promise<T>;
export type UseCaseMap = Readonly<Record<string, Constructor<object>>>;
export type ResolvedUseCases<TUseCase extends UseCaseMap> = {
  readonly [TKey in keyof TUseCase]: TUseCase[TKey] extends Constructor<infer TValue> ? TValue : never;
};

interface HandlerBase {
  readonly validator?: unknown;
  readonly guards?: readonly unknown[];
  readonly middlewares?: readonly unknown[];
}

export type HandlerDefinitionWithoutUseCase<TContext, TResult> = HandlerBase & Readonly<{
  readonly useCase?: undefined;
  readonly run: (context: TContext) => MaybePromise<TResult>;
}>;

export type HandlerDefinitionWithUseCase<TContext, TUseCase extends UseCaseMap, TResult> = HandlerBase & Readonly<{
  readonly useCase: TUseCase;
  readonly run: (context: TContext, useCases: ResolvedUseCases<TUseCase>) => MaybePromise<TResult>;
}>;

export type HandlerDefinition<
  TContext = unknown,
  TUseCase extends UseCaseMap | undefined = UseCaseMap | undefined,
  TResult = unknown,
> = TUseCase extends UseCaseMap
  ? HandlerDefinitionWithUseCase<TContext, TUseCase, TResult>
  : HandlerDefinitionWithoutUseCase<TContext, TResult>;
type AnyHandlerDefinition = HandlerBase & Readonly<{
  readonly useCase?: unknown;
  readonly run: unknown;
}>;

/** Defines one transport-neutral handler while preserving the author's context and use-case types. */
export function defineHandler<const TUseCase extends UseCaseMap, TContext, TResult>(
  definition: HandlerDefinitionWithUseCase<TContext, TUseCase, TResult>,
): Readonly<HandlerDefinitionWithUseCase<TContext, TUseCase, TResult>>;
export function defineHandler<TContext, TResult>(
  definition: HandlerDefinitionWithoutUseCase<TContext, TResult>,
): Readonly<HandlerDefinitionWithoutUseCase<TContext, TResult>>;
export function defineHandler(
  definition: AnyHandlerDefinition,
): Readonly<AnyHandlerDefinition> {
  return Object.freeze({
    ...definition,
    ...(definition.guards === undefined ? {} : { guards: Object.freeze([...definition.guards]) }),
    ...(definition.middlewares === undefined ? {} : { middlewares: Object.freeze([...definition.middlewares]) }),
  });
}
