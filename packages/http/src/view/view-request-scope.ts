import { AsyncLocalStorage } from "node:async_hooks";
import { ServerStateError } from "../errors";

/**
 * Ambient per-request state `view()`/`csrf()` read without requiring an `AppRequest`
 * parameter. Populated once per request in `createBunRouteHandler`
 * (`../native/bun-route-handler.ts`), the one place every request passes through before
 * dispatch — and read from the same package, so no cross-package ambient store is
 * needed. `request` is the raw native `Request`; locale/`tr` are attached onto it
 * in-place, later, by `@warbler/i18n`'s `localizeRequest` (inside `@warbler/runtime`) —
 * same object identity, so reading `request.locale`/`request.tr` lazily (only when a
 * built-in is actually invoked) always observes the localized values.
 */
export interface ViewRequestScope {
  readonly request: Request;
  readonly development: boolean;
  /** Mints (once) and returns this request's signed CSRF token. Synchronous and memoized. */
  issueCsrfToken(): string;
  /** Configured CSRF form-field name (e.g. `"_csrf"`), process-wide. */
  readonly csrfFieldName: string;
  /** Process-wide static-asset URL resolver, built once at transport startup. */
  readonly resolveAsset: (path: string) => string;
  /** Process-wide named-route URL resolver, built once at transport startup. */
  readonly resolveRoute: (name: string, params: readonly (string | number)[]) => string;
}

/**
 * Backed by `AsyncLocalStorage`, not a module-level variable: request handling spans
 * real `await` boundaries (validators, guards, middleware, async controller methods),
 * so two concurrent requests must never observe each other's scope. Mirrors
 * `@warbler/core`'s `injection-context.ts` `requestResolvers` pattern.
 */
const storage = new AsyncLocalStorage<ViewRequestScope>();

/** Runs `callback` with `scope` as the active view request scope. */
export function runInViewRequestScope<T>(scope: ViewRequestScope, callback: () => T): T {
  return storage.run(scope, callback);
}

/** Returns the active view request scope, or `undefined` outside of a request. */
export function getViewRequestScope(): ViewRequestScope | undefined {
  return storage.getStore();
}

/** Returns the active view request scope, throwing a clear error when there isn't one. */
export function requireViewRequestScope(): ViewRequestScope {
  const scope = storage.getStore();
  if (scope === undefined) {
    throw new ServerStateError(
      "view()/csrf() were called outside an active HTTP request. " +
      "They can only be used from within a route handler, guard, middleware, or validator callback.",
    );
  }
  return scope;
}
