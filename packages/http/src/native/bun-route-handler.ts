import { csrfFailureResponse, type CsrfPolicy, CsrfVerifier } from "../csrf";
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
): Response | Promise<Response> {
  if (result instanceof Promise) return result.then((response) => applySecurityHeaders(response, securityHeaders));
  return applySecurityHeaders(result, securityHeaders);
}

/** Builds the fixed-order pre-handler pipeline once while retaining synchronous fast paths. */
export function createBunRouteHandler(options: BunRouteHandlerOptions): BunRouteHandler {
  const csrfEnabled = (options.flags & RouteFlag.CSRF_ENABLED) !== 0;
  const sse = (options.flags & RouteFlag.SSE) !== 0;
  return (request, server) => {
    try {
      guardRequestSmuggling(request);
      validateRequestHeaders(request, options.headers);
      validateRequestHost(request, options.allowedHosts);
      if (sse) server.timeout(request, 0);
      if (csrfEnabled) {
        const csrf = options.csrf;
        if (csrf === undefined) return csrfFailureResponse();
        return csrf.verifier.verify(request, csrf.policy, true).then((result) => {
          if (!result.valid) return csrfFailureResponse();
          return finalize(options.handler(request, server), options.securityHeaders);
        });
      }
      return finalize(options.handler(request, server), options.securityHeaders);
    } catch (error) {
      if (error instanceof HttpError) return error.toResponse();
      return new Response("Internal Server Error", { status: 500 });
    }
  };
}
