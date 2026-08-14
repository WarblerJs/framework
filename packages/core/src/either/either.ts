/** Stable discriminant used by Warbler's `Either` result objects. */
export type EitherTag = "Left" | "Right";

/** Exhaustive branch handlers for `Either.match()`. */
export interface EitherMatch<E, T, R> {
  /** Handles the expected business failure branch. */
  readonly left: (error: E) => R;
  /** Handles the successful value branch. */
  readonly right: (value: T) => R;
}

/**
 * Expected-business-failure branch of `Either`.
 *
 * `Left` is intentionally transport-independent. It carries a domain error
 * value and never represents infrastructure exceptions.
 */
export interface Left<E> {
  /** Discriminant for direct tagged-union narrowing. */
  readonly _tag: "Left";
  /** Expected business failure payload. */
  readonly value: E;
  /** Narrows this value to the `Left` branch. */
  isLeft(): this is Left<E>;
  /** Narrows this value away from the `Right` branch. */
  isRight(): this is never;
  /** Exhaustively folds the `Either` into one return value. */
  match<R>(branches: EitherMatch<E, never, R>): R;
  /** Passes `Left` through unchanged without allocating a new result. */
  map<U>(mapper: (value: never) => U): Either<E, U>;
  /** Transforms the expected business failure payload. */
  mapLeft<F>(mapper: (error: E) => F): Either<F, never>;
  /**
   * Throws because this branch has no successful value.
   *
   * This intentionally converts an expected failure into an exception. Use it
   * sparingly, only at boundaries that have already handled or asserted success.
   */
  unwrap(): never;
  /** Returns the fallback for a `Left`. */
  unwrapOr<U>(fallback: U): U;
}

/**
 * Successful branch of `Either`.
 *
 * `Right` carries the successful domain value and has no transport knowledge.
 */
export interface Right<T> {
  /** Discriminant for direct tagged-union narrowing. */
  readonly _tag: "Right";
  /** Successful value payload. */
  readonly value: T;
  /** Narrows this value away from the `Left` branch. */
  isLeft(): this is never;
  /** Narrows this value to the `Right` branch. */
  isRight(): this is Right<T>;
  /** Exhaustively folds the `Either` into one return value. */
  match<R>(branches: EitherMatch<never, T, R>): R;
  /** Transforms the successful value payload. */
  map<U>(mapper: (value: T) => U): Either<never, U>;
  /** Passes `Right` through unchanged without allocating a new result. */
  mapLeft<F>(mapper: (error: never) => F): Either<F, T>;
  /** Returns the successful value. */
  unwrap(): T;
  /** Returns the successful value and ignores the fallback. */
  unwrapOr<U>(fallback: U): T | U;
}

/**
 * A small typed result for expected business failures.
 *
 * Expected business failure -> `Either`.
 * Unexpected exceptional failure -> `throw`.
 */
export type Either<E, T> = Left<E> | Right<T>;

/** Creates an expected-business-failure `Either` branch. */
export function left<E>(error: E): Either<E, never> {
  const result: Left<E> = Object.freeze({
    _tag: "Left",
    value: error,
    isLeft: leftIsLeft as Left<E>["isLeft"],
    isRight: leftIsRight,
    match: leftMatch,
    map: leftMap,
    mapLeft: leftMapLeft,
    unwrap: leftUnwrap,
    unwrapOr: leftUnwrapOr,
  });
  return result;
}

/** Creates a successful `Either` branch. */
export function right<T>(value: T): Either<never, T> {
  const result: Right<T> = Object.freeze({
    _tag: "Right",
    value,
    isLeft: rightIsLeft,
    isRight: rightIsRight as Right<T>["isRight"],
    match: rightMatch as Right<T>["match"],
    map: rightMap as Right<T>["map"],
    mapLeft: rightMapLeft as Right<T>["mapLeft"],
    unwrap: rightUnwrap as Right<T>["unwrap"],
    unwrapOr: rightUnwrapOr as Right<T>["unwrapOr"],
  });
  return result;
}

function leftIsLeft<E>(this: Left<E>): this is Left<E> {
  return true;
}

function leftIsRight(this: Left<unknown>): this is never {
  return false;
}

function leftMatch<E, R>(this: Left<E>, branches: EitherMatch<E, never, R>): R {
  return branches.left(this.value);
}

function leftMap<E, U>(this: Left<E>, _mapper: (value: never) => U): Either<E, U> {
  return this;
}

function leftMapLeft<E, F>(this: Left<E>, mapper: (error: E) => F): Either<F, never> {
  return left(mapper(this.value));
}

function leftUnwrap(this: Left<unknown>): never {
  throw new Error("Cannot unwrap Left Either.", { cause: this.value });
}

function leftUnwrapOr<U>(this: Left<unknown>, fallback: U): U {
  return fallback;
}

function rightIsLeft(this: Right<unknown>): this is never {
  return false;
}

function rightIsRight<T>(this: Right<T>): this is Right<T> {
  return true;
}

function rightMatch<T, R>(this: Right<T>, branches: EitherMatch<never, T, R>): R {
  return branches.right(this.value);
}

function rightMap<T, U>(this: Right<T>, mapper: (value: T) => U): Either<never, U> {
  return right(mapper(this.value));
}

function rightMapLeft<T, F>(this: Right<T>, _mapper: (error: never) => F): Either<F, T> {
  return this;
}

function rightUnwrap<T>(this: Right<T>): T {
  return this.value;
}

function rightUnwrapOr<T, U>(this: Right<T>, _fallback: U): T | U {
  return this.value;
}
