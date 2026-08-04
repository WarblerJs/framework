import { csrfFailureResponse, type CsrfPolicy, CsrfVerifier } from "../csrf";
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

/** Bun-native route handler preserving synchronous handlers as synchronous. */
export type BunRouteHandler = (request: Request, server: Bun.Server<undefined>) => Response | Promise<Response>;

/** Precomputed request pipeline inputs for one Bun route handler. */
export interface BunRouteHandlerOptions {
  readonly handler: BunRouteHandler;
  readonly flags: number;
  readonly allowedHosts: readonly string[];
  readonly headers: RequestHeaderPolicy;
  readonly securityHeaders: Readonly<Record<string, string>>;
  readonly csrf?: Readonly<{ verifier: CsrfVerifier; policy: CsrfPolicy }>;
}

function finalize(
  result: Response | Promise<Response>,
  securityHeaders: Readonly<Record<string, string>>,
  requestLog: RequestHandle,
): Response | Promise<Response> {
  if (result instanceof Promise) return result.then((response) => logResponse(requestLog, applySecurityHeaders(response, securityHeaders)));
  return logResponse(requestLog, applySecurityHeaders(result, securityHeaders));
}

/** Builds the fixed-order pre-handler pipeline once while retaining synchronous fast paths. */
export function createBunRouteHandler(options: BunRouteHandlerOptions): BunRouteHandler {
  const csrfEnabled = (options.flags & RouteFlag.CSRF_ENABLED) !== 0;
  const sse = (options.flags & RouteFlag.SSE) !== 0;
  return (request, server) => {
    const url = new URL(request.url);
    const requestLog = Console.request({ method: request.method, path: url.pathname });
    try {
      guardRequestSmuggling(request);
      validateRequestHeaders(request, options.headers);
      validateRequestHost(request, options.allowedHosts);
      if (sse) server.timeout(request, 0);
      if (csrfEnabled) {
        const csrf = options.csrf;
        if (csrf === undefined) return logResponse(requestLog, csrfFailureResponse(), "CSRF_VALIDATION_FAILED");
        return csrf.verifier.verify(request, csrf.policy, true).then((result) => {
          if (!result.valid) return logResponse(requestLog, csrfFailureResponse(), "CSRF_VALIDATION_FAILED");
          return finalize(options.handler(request, server), options.securityHeaders, requestLog);
        });
      }
      return finalize(options.handler(request, server), options.securityHeaders, requestLog);
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
