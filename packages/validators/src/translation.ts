import type { ValidationErrors, ValidationTranslator } from "./types";

export type TranslatedValidationErrors = Readonly<Record<string, readonly string[]>>;
export function translateValidationErrors(errors: ValidationErrors, translate: ValidationTranslator): TranslatedValidationErrors {
  const output: Record<string, readonly string[]> = Object.create(null);
  for (const [field, issues] of Object.entries(errors)) {
    output[field] = Object.freeze(issues.map((issue) => translate(issue.message.key, issue.message.parameters)));
  }
  return Object.freeze(output);
}
export function firstTranslatedValidationErrors(errors: ValidationErrors, translate: ValidationTranslator): Readonly<Record<string, string>> {
  const output: Record<string, string> = Object.create(null);
  for (const [field, issues] of Object.entries(errors)) {
    const issue = issues[0];
    if (issue !== undefined) output[field] = translate(issue.message.key, issue.message.parameters);
  }
  return Object.freeze(output);
}
