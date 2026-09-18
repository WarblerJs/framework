import type { Constructor } from "../types";

export type MaybePromise<T> = T | Promise<T>;
export type HandlerResult = Response | Promise<Response>;
export type UseCaseMap = Readonly<Record<string, Constructor<object>>>;
export type ResolvedUseCases<TUseCase extends UseCaseMap> = {
  readonly [TKey in keyof TUseCase]: TUseCase[TKey] extends Constructor<infer TValue> ? TValue : never;
};

export interface HandlerMetadata {
  readonly validator?: unknown;
  readonly guards?: readonly unknown[];
  readonly middlewares?: readonly unknown[];
}

export type HandlerFunction<TRequest = unknown> =
  (request: TRequest) => HandlerResult;

export type HandlerObjectWithoutUseCase<TRequest = unknown> = HandlerMetadata & Readonly<{
  readonly useCase?: undefined;
  readonly run: (request: TRequest) => HandlerResult;
}>;

export type HandlerObjectWithUseCase<TRequest, TUseCase extends UseCaseMap> = HandlerMetadata & Readonly<{
  readonly useCase: TUseCase;
  readonly run: (request: TRequest, useCases: ResolvedUseCases<TUseCase>) => HandlerResult;
}>;

export type HandlerObject<
  TRequest = unknown,
  TUseCase extends UseCaseMap | undefined = UseCaseMap | undefined,
> = TUseCase extends UseCaseMap
  ? HandlerObjectWithUseCase<TRequest, TUseCase>
  : HandlerObjectWithoutUseCase<TRequest>;

export type Handler<TRequest = unknown> =
  | HandlerFunction<TRequest>
  | HandlerObject<TRequest>;

/** @deprecated Use HandlerObject instead. */
export type HandlerDefinition<TRequest = unknown> = HandlerObject<TRequest>;
/** @deprecated Use HandlerObjectWithUseCase instead. */
export type HandlerDefinitionWithUseCase<TRequest, TUseCase extends UseCaseMap> = HandlerObjectWithUseCase<TRequest, TUseCase>;
/** @deprecated Use HandlerObjectWithoutUseCase instead. */
export type HandlerDefinitionWithoutUseCase<TRequest = unknown> = HandlerObjectWithoutUseCase<TRequest>;
