import { parseValidationMessage, type TranslationParameter, type ValidationMessage } from "@warbler/i18n";
import type * as z from "zod";
import { ValidatorError, ValidatorErrorCode } from "./errors";

const cache = new Map<string, Readonly<{ key: string; parameterNames: readonly string[] }>>();
export function parseMessageDescriptor(value: string): Readonly<{ key: string; parameterNames: readonly string[] }> {
  const existing = cache.get(value);
  if (existing !== undefined) return existing;
  try {
    const parsed = parseValidationMessage(value);
    cache.set(value, parsed);
    return parsed;
  } catch (cause) {
    throw new ValidatorError(ValidatorErrorCode.INVALID_MESSAGE_DESCRIPTOR, "Validation message descriptor is invalid.", { cause });
  }
}
export function messageDescriptorCacheSize(): number { return cache.size; }

export function issueMessage(issue: z.core.$ZodIssue, input: unknown): ValidationMessage {
  let descriptor: Readonly<{ key: string; parameterNames: readonly string[] }>;
  try { descriptor = parseMessageDescriptor(issue.message); }
  catch { descriptor = Object.freeze({ key: `validators.${issue.code}`, parameterNames: Object.freeze([]) }); }
  const available = issueParameters(issue, input);
  const parameters: Record<string, TranslationParameter> = Object.create(null);
  for (const name of descriptor.parameterNames) {
    const value = available[name];
    if (value !== undefined) parameters[name] = value;
  }
  return Object.freeze({ key: descriptor.key, parameters: Object.freeze(parameters) });
}
function issueParameters(issue: z.core.$ZodIssue, input: unknown): Readonly<Record<string, TranslationParameter>> {
  const record: Record<string, TranslationParameter> = Object.create(null);
  if ("maximum" in issue && typeof issue.maximum === "number") {
    record.allowed = issue.maximum; record.maximum = issue.maximum; record.inclusive = issue.inclusive ?? true;
    const entered = sizeOf(input); if (entered !== undefined) record.entered = entered;
  }
  if ("minimum" in issue && typeof issue.minimum === "number") {
    record.minimum = issue.minimum; record.allowed = issue.minimum; record.inclusive = issue.inclusive ?? true;
    const entered = sizeOf(input); if (entered !== undefined) record.entered = entered;
  }
  if (issue.code === "invalid_type") {
    record.expected = String(issue.expected);
    record.received = typeName(input);
  }
  if (issue.code === "invalid_value" && "values" in issue && Array.isArray(issue.values)) {
    record.options = issue.values.slice(0, 20).map(String).join(", ");
    record.received = typeName(input);
  }
  return record;
}
function sizeOf(value: unknown): number | undefined {
  if (typeof value === "string" || Array.isArray(value)) return value.length;
  if (value instanceof Map || value instanceof Set) return value.size;
  return undefined;
}
function typeName(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}
