import { AsyncLocalStorage } from "node:async_hooks";
import { MissingInjectionContextError } from "../errors";
import type { InjectionResolver } from "./injection-resolver";

let activeResolver: InjectionResolver | undefined;
/**
 * Request-scoped resolver storage. A plain module variable (as used for `runInInjectionContext`) is only
 * safe because every synchronous-scope caller wraps one `new X()` call with no `await` in between — under
 * concurrent request handling, an ambient scope that spans real `await`s needs `AsyncLocalStorage` so two
 * in-flight requests can't corrupt each other's active resolver.
 */
const requestResolvers = new AsyncLocalStorage<InjectionResolver>();

/** Executes a callback with an active dependency-injection resolver (synchronous scope, e.g. provider construction). */
export function runInInjectionContext<T>(resolver: InjectionResolver, callback: () => T): T {
  const previous = activeResolver;
  activeResolver = resolver;
  try {
    return callback();
  } finally {
    activeResolver = previous;
  }
}

/** Executes a callback with an active request-scoped resolver, safe across `await` boundaries. */
export function runInRequestContext<T>(resolver: InjectionResolver, callback: () => T): T {
  return requestResolvers.run(resolver, callback);
}

/** Returns the currently active dependency-injection resolver. */
export function getActiveContainer(): InjectionResolver {
  const resolver = activeResolver ?? requestResolvers.getStore();
  if (resolver === undefined) throw new MissingInjectionContextError();
  return resolver;
}
