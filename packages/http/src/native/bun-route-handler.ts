import { csrfFailureResponse, stripCsrfBodyField, type CsrfPolicy, CsrfVerifier } from "../csrf";
import { Console, createCorrelationId, type RequestHandle } from "@warbler/console";
import { WarblerError } from "@warbler/core";
import { HttpError, renderRequestError } from "../errors";
import { RouteFlag } from "../compiled";
import {
  createSecurityHeaderApplicator,
  guardRequestSmuggling,
  type SecurityHeaderApplicator,
  validateRequestHeaders,
  validateRequestHost,
  getForwardedClientIp,
  type ForwardedHeaderPolicy,
  type RequestHeaderPolicy,
} from "../security";
import { runInViewRequestScope, type ViewRequestScope } from "../view";

/** Bun-native route handler preserving synchronous handlers as synchronous. */
export type BunRouteHandler = (request: Request, server: Bun.Server<undefined>) => Response | Promise<Response>;
type HttpProfileStage = "requestPreparation" | "contextPreparation" | "generatedDispatch" | "securityHeaders";

/** Structural profiler contract supplied by Runtime only when HTTP profiling is enabled. */
export interface HttpHotPathRecorder {
  readonly enabled: true;
  record(stage: HttpProfileStage, durationMs: number): void;
  recordRequest(durationMs: number): void;
}

/** Process-wide `asset()`/`route()` resolvers, built once at transport startup. */
export interface ViewBuiltinResolvers {
  readonly asset: (path: string) => string;
  readonly route: (name: string, params: readonly (string | number)[]) => string;
}

/** Precomputed request pipeline inputs for one Bun route handler. */
export interface BunRouteHandlerOptions {
  readonly handler: BunRouteHandler;
  readonly flags: number;
  readonly allowedHosts: readonly string[];
  readonly forwarded: ForwardedHeaderPolicy;
  readonly headers: RequestHeaderPolicy;
  readonly securityHeaders: Readonly<Record<string, string>>;
  readonly csrf?: Readonly<{ verifier: CsrfVerifier; policy: CsrfPolicy }>;
  readonly builtins: ViewBuiltinResolvers;
  readonly development: boolean;
  readonly logging?: Readonly<{ readonly requests?: boolean; readonly errors?: boolean }>;
  readonly profiler?: HttpHotPathRecorder;
  readonly viewScope?: boolean;
}

function finalize(
  result: Response | Promise<Response>,
  applyHeaders: SecurityHeaderApplicator,
  requestLog: RequestHandle,
): Response | Promise<Response> {
  if (result instanceof Promise) return result.then((response) => logResponse(requestLog, applyHeaders(response)));
  return logResponse(requestLog, applyHeaders(result));
}

function finalizeQuiet(
  result: Response | Promise<Response>,
  applyHeaders: SecurityHeaderApplicator,
): Response | Promise<Response> {
  if (result instanceof Promise) return result.then((response) => applyHeaders(response));
  return applyHeaders(result);
}

function finalizeProfiled(
  result: Response | Promise<Response>,
  applyHeaders: SecurityHeaderApplicator,
  profiler: HttpHotPathRecorder,
): Response | Promise<Response> {
  if (result instanceof Promise) {
    return result.then((response) => {
      const securityStart = performance.now();
      const secured = applyHeaders(response);
      profiler.record("securityHeaders", performance.now() - securityStart);
      return secured;
    });
  }
  const securityStart = performance.now();
  const secured = applyHeaders(result);
  profiler.record("securityHeaders", performance.now() - securityStart);
  return secured;
}

/** Builds this request's ambient view scope: a lazily minted, memoized CSRF token plus the process-wide resolvers. */
function createViewRequestScope(
  request: Request,
  options: BunRouteHandlerOptions,
): ViewRequestScope {
  let cachedToken: string | undefined;
  return Object.freeze({
    request,
    development: options.development,
    csrfFieldName: options.csrf?.policy.fieldName ?? "_csrf",
    resolveAsset: options.builtins.asset,
    resolveRoute: options.builtins.route,
    issueCsrfToken(): string {
      if (cachedToken === undefined) {
        const verifier = options.csrf?.verifier;
        cachedToken = verifier === undefined
          ? crypto.randomUUID()
          : verifier.signSync(crypto.randomUUID());
      }
      return cachedToken;
    },
  });
}

/** Reuses `HttpError`'s own stable code where one exists, for consistent `logResponse` metadata. */
function errorCode(error: unknown): string | undefined {
  if (error instanceof WarblerError) return error.code;
  return error instanceof HttpError ? error.code : undefined;
}

/**
 * Builds the fixed-order pre-handler pipeline once while retaining synchronous fast paths.
 *
 * The unified exception boundary lives here: whatever `options.handler(...)` throws
 * synchronously *or* its returned promise rejects with — a controller, service, repository,
 * guard, middleware, or validator's `onValidationError` throw, anywhere in the compiled
 * pipeline — is rendered through `renderRequestError` exactly once, through the same code
 * path for both cases. Nothing past this function ever sees a rejected route-handler
 * promise or a native Bun error page.
 */
export function createBunRouteHandler(options: BunRouteHandlerOptions): BunRouteHandler {
  if (options.profiler?.enabled === true) return createProfiledBunRouteHandler(options, options.profiler);
  return options.logging?.requests === false ? createQuietBunRouteHandler(options) : createLoggedBunRouteHandler(options);
}

function createLoggedBunRouteHandler(options: BunRouteHandlerOptions): BunRouteHandler {
  const csrfEnabled = (options.flags & RouteFlag.CSRF_ENABLED) !== 0;
  const sse = (options.flags & RouteFlag.SSE) !== 0;
  const logErrors = options.logging?.errors !== false;
  const viewScope = options.viewScope !== false;
  const applyHeaders = createSecurityHeaderApplicator(options.securityHeaders);
  return (request, server) => {
    const url = new URL(request.url);
    const requestLog = Console.request({ method: request.method, path: url.pathname });
    const scope = viewScope ? createViewRequestScope(request, options) : undefined;
    const onError = (error: unknown): Response =>
      logResponse(requestLog, renderRequestError(error, request, requestLog, options.development, {
        logErrors,
        clientIp: clientIp(request, server, options.forwarded),
      }), errorCode(error));
    const execute = (): Response | Promise<Response> => {
      if (csrfEnabled) {
        const csrf = options.csrf;
        if (csrf === undefined) return logResponse(requestLog, csrfFailureResponse(), "CSRF_VALIDATION_FAILED");
        return csrf.verifier.verify(request, csrf.policy, true).then(async (result) => {
          if (!result.valid) return logResponse(requestLog, csrfFailureResponse(), "CSRF_VALIDATION_FAILED");
          // The token travelled in the body: strip it before the validated handler
          // pipeline parses that same body, so a strict application schema never has
          // to know the framework's CSRF field exists.
          if (result.source === "form" || result.source === "json") {
            await stripCsrfBodyField(request, csrf.policy.fieldName, result.source);
          }
          return finalize(options.handler(request, server), applyHeaders, requestLog);
        });
      }
      return finalize(options.handler(request, server), applyHeaders, requestLog);
    };
    const dispatch = (): Response | Promise<Response> => scope === undefined ? execute() : runInViewRequestScope(scope, execute);
    try {
      guardRequestSmuggling(request);
      validateRequestHeaders(request, options.headers);
      validateRequestHost(request, options.allowedHosts);
      if (sse) server.timeout(request, 0);
      const result = dispatch();
      return result instanceof Promise ? result.catch(onError) : result;
    } catch (error) {
      return onError(error);
    }
  };
}

function createQuietBunRouteHandler(options: BunRouteHandlerOptions): BunRouteHandler {
  const csrfEnabled = (options.flags & RouteFlag.CSRF_ENABLED) !== 0;
  const sse = (options.flags & RouteFlag.SSE) !== 0;
  const logErrors = options.logging?.errors !== false;
  const viewScope = options.viewScope !== false;
  const applyHeaders = createSecurityHeaderApplicator(options.securityHeaders);
  return (request, server) => {
    const scope = viewScope ? createViewRequestScope(request, options) : undefined;
    const onError = (error: unknown): Response =>
      applyHeaders(renderRequestError(error, request, { requestId: createCorrelationId("req") }, options.development, {
        logErrors,
        clientIp: clientIp(request, server, options.forwarded),
      }));
    const execute = (): Response | Promise<Response> => {
      if (csrfEnabled) {
        const csrf = options.csrf;
        if (csrf === undefined) return applyHeaders(csrfFailureResponse());
        return csrf.verifier.verify(request, csrf.policy, true).then(async (result) => {
          if (!result.valid) return applyHeaders(csrfFailureResponse());
          if (result.source === "form" || result.source === "json") {
            await stripCsrfBodyField(request, csrf.policy.fieldName, result.source);
          }
          return finalizeQuiet(options.handler(request, server), applyHeaders);
        });
      }
      return finalizeQuiet(options.handler(request, server), applyHeaders);
    };
    const dispatch = (): Response | Promise<Response> => scope === undefined ? execute() : runInViewRequestScope(scope, execute);
    try {
      guardRequestSmuggling(request);
      validateRequestHeaders(request, options.headers);
      validateRequestHost(request, options.allowedHosts);
      if (sse) server.timeout(request, 0);
      const result = dispatch();
      return result instanceof Promise ? result.catch(onError) : result;
    } catch (error) {
      return onError(error);
    }
  };
}

function createProfiledBunRouteHandler(options: BunRouteHandlerOptions, profiler: HttpHotPathRecorder): BunRouteHandler {
  const csrfEnabled = (options.flags & RouteFlag.CSRF_ENABLED) !== 0;
  const sse = (options.flags & RouteFlag.SSE) !== 0;
  const logErrors = options.logging?.errors !== false;
  const viewScope = options.viewScope !== false;
  const applyHeaders = createSecurityHeaderApplicator(options.securityHeaders);
  return (request, server) => {
    const requestStart = performance.now();
    const contextStart = performance.now();
    const scope = viewScope ? createViewRequestScope(request, options) : undefined;
    profiler.record("contextPreparation", performance.now() - contextStart);
    const onError = (error: unknown): Response =>
      applyHeaders(renderRequestError(error, request, { requestId: createCorrelationId("req") }, options.development, {
        logErrors,
        clientIp: clientIp(request, server, options.forwarded),
      }));
    const execute = (): Response | Promise<Response> => {
      if (csrfEnabled) {
        const csrf = options.csrf;
        if (csrf === undefined) return applyHeaders(csrfFailureResponse());
        return csrf.verifier.verify(request, csrf.policy, true).then(async (result) => {
          if (!result.valid) return applyHeaders(csrfFailureResponse());
          if (result.source === "form" || result.source === "json") {
            await stripCsrfBodyField(request, csrf.policy.fieldName, result.source);
          }
          return finalizeProfiled(profileGeneratedDispatch(() => options.handler(request, server), profiler), applyHeaders, profiler);
        });
      }
      return finalizeProfiled(profileGeneratedDispatch(() => options.handler(request, server), profiler), applyHeaders, profiler);
    };
    const dispatch = (): Response | Promise<Response> => scope === undefined ? execute() : runInViewRequestScope(scope, execute);
    try {
      const preparationStart = performance.now();
      guardRequestSmuggling(request);
      validateRequestHeaders(request, options.headers);
      validateRequestHost(request, options.allowedHosts);
      if (sse) server.timeout(request, 0);
      profiler.record("requestPreparation", performance.now() - preparationStart);
      const result = dispatch();
      if (result instanceof Promise) {
        return result.then((response) => {
          profiler.recordRequest(performance.now() - requestStart);
          return response;
        }, (error: unknown) => {
          profiler.recordRequest(performance.now() - requestStart);
          return onError(error);
        });
      }
      profiler.recordRequest(performance.now() - requestStart);
      return result;
    } catch (error) {
      profiler.recordRequest(performance.now() - requestStart);
      return onError(error);
    }
  };
}

function profileGeneratedDispatch(callback: () => Response | Promise<Response>, profiler: HttpHotPathRecorder): Response | Promise<Response> {
  const startedAt = performance.now();
  const result = callback();
  if (result instanceof Promise) {
    return result.then((response) => {
      profiler.record("generatedDispatch", performance.now() - startedAt);
      return response;
    });
  }
  profiler.record("generatedDispatch", performance.now() - startedAt);
  return result;
}
function logResponse(request: RequestHandle, response: Response, code?: string): Response {
  const length = response.headers.get("content-length");
  const bytes = length === null ? undefined : Number(length);
  Console.response(request, {
    status: response.status,
    ...(bytes === undefined || !Number.isFinite(bytes) ? {} : { bytes }),
    ...(code === undefined ? {} : { code }),
  });
  return response;
}

function clientIp(request: Request, server: Bun.Server<undefined>, policy: ForwardedHeaderPolicy): string {
  const candidate = typeof server.requestIP === "function" ? server.requestIP(request)?.address : undefined;
  const immediate = candidate ?? "unknown";
  return getForwardedClientIp(request, immediate, policy);
}
