import { parseValidationMessage, type TranslationParameter, type ValidationMessage } from "@warblerjs/i18n";
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
export function validationMessage(specification: string, available: Readonly<Record<string, TranslationParameter>>): ValidationMessage {
  const descriptor = parseMessageDescriptor(specification);
  const parameters: Record<string, TranslationParameter> = Object.create(null);
  const names = descriptor.parameterNames;
  const total = names.length;
  for (let index = 0; index < total; index += 1) {
    const name = names[index]!;
    const value = available[name];
    if (value !== undefined) parameters[name] = value;
  }
  return Object.freeze({ key: descriptor.key, parameters: Object.freeze(parameters) });
}
export function issueParameters(
  allowed: number | string | boolean | bigint | null | undefined,
  entered: number | string | boolean | bigint | null | undefined,
): Readonly<Record<string, TranslationParameter>> {
  const record: Record<string, TranslationParameter> = Object.create(null);
  if (allowed !== undefined) {
    record.allowed = allowed; record.expected = allowed; record.minimum = allowed; record.maximum = allowed;
  }
  if (entered !== undefined) {
    record.entered = entered; record.received = entered;
  }
  return Object.freeze(record);
}
