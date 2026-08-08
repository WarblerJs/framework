import { Console, type RequestHandle } from "@warbler/console";
import { JsonRes } from "../response";
import { toNormalizedHttpError } from "./normalize-http-error";

const PRODUCTION_TEXT_BODY = "Internal Server Error";

function prefersHtml(request: Request): boolean {
  const accept = request.headers.get("accept") ?? "";
  const htmlIndex = accept.indexOf("text/html");
  if (htmlIndex === -1) return false;
  const jsonIndex = accept.indexOf("application/json");
  return jsonIndex === -1 || htmlIndex < jsonIndex;
}

function internalReason(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function textResponse(body: string, status: number): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

/**
 * Converts any failure thrown while handling an HTTP request into a safe `Response` —
 * the transport-aware renderer for the unified exception boundary. Never throws itself.
 * Logs full internal detail via `Console.error` in both modes; the response body only
 * ever contains what the normalized error actually marks safe to expose, plus (in
 * development only) organized, request-scoped diagnostic metadata — never a stack,
 * source path, or secret.
 */
export function renderRequestError(
  error: unknown,
  request: Request,
  requestLog: RequestHandle,
  development: boolean,
): Response {
  const normalized = toNormalizedHttpError(error);
  const url = new URL(request.url);
  const requestLine = `${request.method} ${url.pathname}`;

  Console.error("Request failed.", {
    requestId: requestLog.requestId,
    method: request.method,
    path: url.pathname,
    code: normalized.code,
    status: normalized.status,
  });

  if (prefersHtml(request)) {
    if (!development) {
      return textResponse(normalized.expose ? normalized.message : PRODUCTION_TEXT_BODY, normalized.status);
    }
    const lines = [
      "WARBLER_REQUEST_ERROR",
      "",
      `Code: ${normalized.code}`,
      "Transport: HTTP",
      `Request: ${requestLine}`,
      `Reason: ${internalReason(normalized.cause)}`,
      `RequestId: ${requestLog.requestId}`,
    ];
    return textResponse(lines.join("\n"), normalized.status);
  }

  const body: Record<string, string> = { code: normalized.code, message: normalized.message };
  if (development) {
    body.transport = "HTTP";
    body.request = requestLine;
    body.reason = internalReason(normalized.cause);
    body.requestId = requestLog.requestId;
  }
  return JsonRes(body, { status: normalized.status });
}
