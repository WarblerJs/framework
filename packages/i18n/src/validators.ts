import { I18nError, I18nErrorCode } from "./errors";
import { parseTranslationKey } from "./key";
import type { TranslationParameter, ValidationMessage } from "./types";

const PARAMETER = /^[A-Za-z][A-Za-z0-9_]{0,63}$/u;
export interface ParsedValidationMessage { readonly key: string; readonly parameterNames: readonly string[] }

export function parseValidationMessage(value: string): ParsedValidationMessage {
  const separator = value.indexOf(":");
  const key = separator === -1 ? value : value.slice(0, separator);
  parseTranslationKey(key);
  if (separator === -1) return Object.freeze({ key, parameterNames: Object.freeze([]) });
  const syntax = value.slice(separator + 1);
  if (syntax.length === 0) invalid();
  const names = syntax.split("::");
  if (names.some((name) => !PARAMETER.test(name)) || new Set(names).size !== names.length) invalid();
  return Object.freeze({ key, parameterNames: Object.freeze(names) });
}

export function createValidationMessage(
  specification: string,
  values: Readonly<Record<string, TranslationParameter>>,
): ValidationMessage {
  const parsed = parseValidationMessage(specification);
  const parameters: Record<string, TranslationParameter> = Object.create(null);
  for (const name of parsed.parameterNames) {
    if (!Object.prototype.hasOwnProperty.call(values, name)) throw new I18nError(I18nErrorCode.INVALID_MESSAGE, `Validation parameter "${name}" was not supplied.`);
    parameters[name] = values[name]!;
  }
  return Object.freeze({ key: parsed.key, parameters: Object.freeze(parameters) });
}
function invalid(): never { throw new I18nError(I18nErrorCode.INVALID_MESSAGE, "Validation message syntax is invalid."); }
