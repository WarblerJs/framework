// export type Guard<TInput> = (
//     input: TInput,
//   ) => boolean | Promise<boolean>;
// route/guard.types.ts
export type MaybePromise<T> = T | Promise<T>;

export interface RequestContext {
  readonly [key: string]: unknown;
}

export type Guard<
  TContext extends RequestContext = RequestContext,
> = (
  context: TContext,
) => MaybePromise<boolean>;