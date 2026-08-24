import { activeCompiledViews, renderCompiledView } from "@warblerjs/view";
import type { ViewData, ViewDataValue } from "@warblerjs/view";
import { EmailTemplateError } from "../errors";

/** Template data accepted by the email renderer. */
export type EmailTemplateData = Readonly<Record<string, unknown>>;

/** Rendering contract used by Email before MIME encoding. */
export interface EmailTemplateRenderer {
  render(name: string, data: EmailTemplateData): Promise<string> | string;
}

function toViewDataValue(value: unknown): ViewDataValue {
  if (value === null || value === undefined || typeof value === "string" || typeof value === "number" || typeof value === "boolean" || typeof value === "bigint" || value instanceof Date) {
    return value;
  }
  if (Array.isArray(value)) return Object.freeze(value.map(toViewDataValue));
  if (typeof value === "object") {
    const output: Record<string, ViewDataValue> = {};
    for (const [key, item] of Object.entries(value)) output[key] = toViewDataValue(item);
    return Object.freeze(output);
  }
  return String(value);
}

function toViewData(data: EmailTemplateData): ViewData {
  const output: Record<string, ViewDataValue> = {};
  for (const [key, value] of Object.entries(data)) output[key] = toViewDataValue(value);
  return Object.freeze(output);
}

/** Renderer backed by the active compiled Warbler view artifact. */
export const compiledViewEmailRenderer: EmailTemplateRenderer = Object.freeze({
  render(name: string, data: EmailTemplateData) {
    const artifact = activeCompiledViews();
    if (artifact === undefined) throw new EmailTemplateError(`No compiled view artifact is active for "${name}".`);
    return renderCompiledView({ artifact, name, data: toViewData(data) });
  },
});
