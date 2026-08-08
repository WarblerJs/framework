import { Console } from "@warbler/console";
import {
  activeCompiledViews,
  isViewError,
  offsetToLineColumn,
  TemplateCompilationError,
  TemplateExpressionError,
  ViewNotFoundException,
} from "@warbler/view";

const PRODUCTION_BODY = "Internal Server Error\n\nThe requested view could not be rendered.";

function textResponse(body: string): Response {
  return new Response(body, {
    status: 500,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

function viewNameOf(error: unknown): string | undefined {
  if (error instanceof ViewNotFoundException) return error.viewName;
  if (error instanceof TemplateCompilationError) return error.viewName;
  if (error instanceof TemplateExpressionError) return error.viewName;
  return undefined;
}

function sourceOf(viewName: string): string | undefined {
  return activeCompiledViews()?.templates[viewName];
}

/**
 * Formats a caught view-rendering failure as an organized, safe plain-text response —
 * "use actual available metadata only": every line below is included only when the
 * failing error actually carries that piece of information (a reserved-variable
 * collision, for instance, has no Line/Column/Expression, only a Reason).
 */
function formatDevelopmentBody(error: unknown, request: Request): string {
  const lines: string[] = ["WARBLER_VIEW_RENDER_ERROR", ""];
  const viewName = viewNameOf(error);
  if (viewName !== undefined) lines.push(`Template: ${viewName}`, "");

  if (error instanceof TemplateExpressionError) {
    if (error.offset !== undefined) {
      const source = sourceOf(error.viewName);
      if (source !== undefined) {
        const position = offsetToLineColumn(source, error.offset);
        lines.push(`Line: ${position.line}`, `Column: ${position.column}`);
      }
    }
    lines.push(`Expression: ${error.expression}`, `Reason: ${error.detail}`, "");
  } else if (isViewError(error)) {
    lines.push(`Reason: ${error.message}`, "");
  } else {
    lines.push(`Reason: ${error instanceof Error ? error.message : String(error)}`, "");
  }

  const url = new URL(request.url);
  lines.push("Request:", `${request.method} ${url.pathname}`);
  return lines.join("\n");
}

/**
 * Converts any failure thrown while rendering a view into a safe `Response` — never a
 * raw Bun error page. Development responses are organized plain text built only from
 * fields the error actually carries; production responses are a fixed, generic
 * message with no stack, path, source, or token. Full details are always logged
 * server-side via the existing console logger.
 */
export function viewErrorResponse(error: unknown, request: Request, development: boolean): Response {
  Console.error("View render failed.", {
    message: error instanceof Error ? error.message : String(error),
    code: isViewError(error) ? error.code : undefined,
    view: viewNameOf(error),
    path: new URL(request.url).pathname,
  });

  return development
    ? textResponse(formatDevelopmentBody(error, request))
    : textResponse(PRODUCTION_BODY);
}
