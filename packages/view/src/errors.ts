/** Base error for deterministic Warbler view failures. */
export class ViewError extends Error {
  public constructor(
    message: string,
    public readonly code: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ViewError";
  }
}

/** Error thrown when a logical template name cannot be resolved. */
export class ViewNotFoundException extends ViewError {
  public constructor(
    public readonly viewName: string,
    public readonly availableTemplates: readonly string[] = Object.freeze([]),
  ) {
    super(`Compiled view template was not found: ${viewName}`, "VIEW1001");
    this.name = "ViewNotFoundException";
  }
}

/** Error thrown when a template cannot be parsed or compiled. */
export class TemplateCompilationError extends ViewError {
  public constructor(
    public readonly viewName: string,
    public readonly detail: string,
    cause?: unknown,
  ) {
    super(`Failed to compile view template: ${viewName}. ${detail}`, "VIEW1002", {
      cause,
    });
    this.name = "TemplateCompilationError";
  }
}

/** Error thrown when a template expression fails at render time. */
export class TemplateExpressionError extends ViewError {
  public constructor(
    public readonly viewName: string,
    public readonly expression: string,
    public readonly detail: string,
    public readonly availableVariables: readonly string[],
    cause?: unknown,
  ) {
    super(`Failed to evaluate template expression: ${expression}`, "VIEW1003", {
      cause,
    });
    this.name = "TemplateExpressionError";
  }
}

/** Checks whether a failure belongs to the Warbler view package. */
export const isViewError = (value: unknown): value is ViewError =>
  value instanceof ViewError;

const errorDetail = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** Formats a view error as safe plain text for development responses. */
export const formatViewError = (
  error: ViewError,
  availableTemplates: readonly string[] = Object.freeze([]),
): string => {
  if (error instanceof ViewNotFoundException) {
    const available = availableTemplates.length > 0
      ? availableTemplates
      : error.availableTemplates;

    return [
      `View template not found: ${error.viewName}`,
      "",
      "Available templates:",
      ...(available.length === 0
        ? ["  (none)"]
        : [...available].sort((left, right) => left.localeCompare(right, "en"))
          .map((name) => `  ${name}`)),
    ].join("\n");
  }

  if (error instanceof TemplateExpressionError) {
    return [
      "Warbler Template Error",
      "",
      "View:",
      `  ${error.viewName}`,
      "",
      "Expression:",
      `  ${error.expression}`,
      "",
      "Message:",
      `  ${error.detail}`,
      "",
      "Available variables:",
      ...(error.availableVariables.length === 0
        ? ["  (none)"]
        : error.availableVariables.map((name) => `  ${name}`)),
    ].join("\n");
  }

  if (error instanceof TemplateCompilationError) {
    return [
      "Warbler Template Compile Error",
      "",
      "View:",
      `  ${error.viewName}`,
      "",
      "Message:",
      `  ${error.detail}`,
    ].join("\n");
  }

  return [
    "Warbler Template Error",
    "",
    "Message:",
    `  ${errorDetail(error)}`,
  ].join("\n");
};
