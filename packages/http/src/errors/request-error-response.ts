import { Console } from "@warbler/console";
import { errorCauseChain, safeErrorMessage } from "@warbler/core";
import { JsonRes } from "../response";
import { toNormalizedHttpError } from "./normalize-http-error";

const HTML_ERROR_TEMPLATE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Warbler Error</title>
<style>
:root{color-scheme:light dark}body{margin:0;font:14px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;background:#fff;color:#111}main{max-width:920px;margin:0 auto;padding:48px 24px}h1{font-size:18px;font-weight:700;margin:0 0 24px}.line{white-space:pre-wrap;border-top:1px solid #111;padding:10px 0}.muted{color:#555}@media (prefers-color-scheme:dark){body{background:#000;color:#eee}.line{border-color:#eee}.muted{color:#aaa}}</style>
</head>
<body><main><h1>WARBLER_REQUEST_ERROR</h1>{{BODY}}</main></body>
</html>`;

export interface RequestErrorRenderOptions {
  readonly logErrors?: boolean;
  readonly clientIp?: string;
  readonly handler?: string;
}

function prefersHtml(request: Request): boolean {
  const accept = request.headers.get("accept") ?? "";
  const htmlIndex = accept.indexOf("text/html");
  if (htmlIndex === -1) return false;
  const jsonIndex = accept.indexOf("application/json");
  return jsonIndex === -1 || htmlIndex < jsonIndex;
}

function response(body: string, status: number, contentType: string): Response {
  return new Response(body, {
    status,
    headers: { "content-type": contentType },
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
  requestLog: Readonly<{ readonly requestId: string }>,
  development: boolean,
  renderOptions: boolean | RequestErrorRenderOptions = true,
): Response {
  const options: RequestErrorRenderOptions = typeof renderOptions === "boolean" ? Object.freeze({ logErrors: renderOptions }) : renderOptions;
  const normalized = toNormalizedHttpError(error);
  const url = new URL(request.url);
  const requestLine = `${request.method} ${url.pathname}`;
  const safeMessage = safeErrorMessage(normalized, development);
  const stack = diagnosticStack(normalized);

  if (options.logErrors !== false) {
    Console.error("Request failed.", {
      requestId: requestLog.requestId,
      method: request.method,
      path: url.pathname,
      code: normalized.code,
      status: normalized.status,
    });
    const report: {
      code: string;
      status: number;
      message: string;
      developerMessage: string;
      fatal: boolean;
      stack?: string;
      cause: unknown;
    } = {
      code: normalized.code,
      status: normalized.status,
      message: safeErrorMessage(normalized, false),
      developerMessage: diagnosticReason(normalized),
      fatal: normalized.fatal,
      cause: normalized.cause,
    };
    if (stack !== undefined) report.stack = stack;
    const context: {
      method: string;
      path: string;
      requestId: string;
      transport: string;
      clientIp?: string;
      handler?: string;
    } = {
      method: request.method,
      path: url.pathname,
      requestId: requestLog.requestId,
      transport: "HTTP",
    };
    if (options.clientIp !== undefined) context.clientIp = options.clientIp;
    if (options.handler !== undefined) context.handler = options.handler;
    Console.errorReport(Object.freeze(report), Object.freeze(context));
  }

  if (prefersHtml(request)) {
    if (!development) {
      return htmlResponse(Object.freeze([
        ["Code", normalized.code],
        ["Status", String(normalized.status)],
        ["Message", safeErrorMessage(normalized, false)],
        ["Request ID", requestLog.requestId],
      ]), normalized.status);
    }
    const rows: [string, string][] = [
      ["Code", normalized.code],
      ["Transport", "HTTP"],
      ["Request", requestLine],
      ["Reason", diagnosticReason(normalized)],
      ["Request ID", requestLog.requestId],
      ["Cause Chain", formatCauseChain(normalized)],
    ];
    if (stack !== undefined) rows.splice(5, 0, ["Stack", stack]);
    return htmlResponse(Object.freeze(rows), normalized.status);
  }

  const body: Record<string, string> = { code: normalized.code, message: safeMessage, requestId: requestLog.requestId };
  if (development) {
    body.transport = "HTTP";
    body.request = requestLine;
    body.reason = diagnosticReason(normalized);
    if (stack !== undefined) body.stack = stack;
  }
  return JsonRes(body, { status: normalized.status });
}

function htmlResponse(rows: readonly (readonly [string, string])[], status: number): Response {
  let body = "";
  for (const [label, value] of rows) body += `<div class="line"><span class="muted">${escapeHtml(label)}:</span> ${escapeHtml(value)}</div>`;
  return response(HTML_ERROR_TEMPLATE.replace("{{BODY}}", body), status, "text/html; charset=utf-8");
}

function diagnosticReason(error: ReturnType<typeof toNormalizedHttpError>): string {
  return error.developerMessage ?? error.message;
}

function diagnosticStack(error: ReturnType<typeof toNormalizedHttpError>): string | undefined {
  return error.cause instanceof Error ? error.cause.stack ?? error.stack : error.stack;
}

function formatCauseChain(error: ReturnType<typeof toNormalizedHttpError>): string {
  const chain = errorCauseChain(error);
  let output = "";
  for (const item of chain) output += `${output.length === 0 ? "" : "\n"}${item.name}: ${item.message}`;
  return output;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
