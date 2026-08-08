import { csrfFailureResponse, stripCsrfBodyField, type CsrfPolicy, CsrfVerifier } from "../csrf";
import { Console, type RequestHandle } from "@warbler/console";
import { HttpError } from "../errors";
import { RouteFlag } from "../compiled";
import {
  applySecurityHeaders,
  guardRequestSmuggling,
  validateRequestHeaders,
  validateRequestHost,
  type RequestHeaderPolicy,
} from "../security";
import { runInViewRequestScope, type ViewRequestScope } from "../view";

/** Bun-native route handler preserving synchronous handlers as synchronous. */
export type BunRouteHandler = (request: Request, server: Bun.Server<undefined>) => Response | Promise<Response>;

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
  readonly headers: RequestHeaderPolicy;
  readonly securityHeaders: Readonly<Record<string, string>>;
  readonly csrf?: Readonly<{ verifier: CsrfVerifier; policy: CsrfPolicy }>;
  readonly builtins: ViewBuiltinResolvers;
  readonly development: boolean;
}

function finalize(
  result: Response | Promise<Response>,
  securityHeaders: Readonly<Record<string, string>>,
  requestLog: RequestHandle,
): Response | Promise<Response> {
  if (result instanceof Promise) return result.then((response) => logResponse(requestLog, applySecurityHeaders(response, securityHeaders)));
  return logResponse(requestLog, applySecurityHeaders(result, securityHeaders));
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

/** Builds the fixed-order pre-handler pipeline once while retaining synchronous fast paths. */
export function createBunRouteHandler(options: BunRouteHandlerOptions): BunRouteHandler {
  const csrfEnabled = (options.flags & RouteFlag.CSRF_ENABLED) !== 0;
  const sse = (options.flags & RouteFlag.SSE) !== 0;
  return (request, server) => {
    const url = new URL(request.url);
    const requestLog = Console.request({ method: request.method, path: url.pathname });
    const scope = createViewRequestScope(request, options);
    const dispatch = (): Response | Promise<Response> => runInViewRequestScope(scope, () => {
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
          return finalize(options.handler(request, server), options.securityHeaders, requestLog);
        });
      }
      return finalize(options.handler(request, server), options.securityHeaders, requestLog);
    });
    try {
      guardRequestSmuggling(request);
      validateRequestHeaders(request, options.headers);
      validateRequestHost(request, options.allowedHosts);
      if (sse) server.timeout(request, 0);
      return dispatch();
    } catch (error) {
      if (error instanceof HttpError) return logResponse(requestLog, error.toResponse(), error.code);
      return logResponse(requestLog, new Response("Internal Server Error", { status: 500 }), "UNEXPECTED_EXCEPTION");
    }
  };
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
