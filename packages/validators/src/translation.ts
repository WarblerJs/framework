import type { ValidationErrors, ValidationTranslator } from "./types";

export type TranslatedValidationErrors = Readonly<Record<string, readonly string[]>>;
export function translateValidationErrors(errors: ValidationErrors, translate: ValidationTranslator): TranslatedValidationErrors {
  const output: Record<string, readonly string[]> = Object.create(null);
  for (const field in errors) {
    const issues = errors[field]!;
    const total = issues.length;
    const messages = new Array<string>(total);
    for (let index = 0; index < total; index += 1) {
      const issue = issues[index]!;
      messages[index] = translate(issue.message.key, issue.message.parameters);
    }
    output[field] = Object.freeze(messages);
  }
  return Object.freeze(output);
}
export function firstTranslatedValidationErrors(errors: ValidationErrors, translate: ValidationTranslator): Readonly<Record<string, string>> {
  const output: Record<string, string> = Object.create(null);
  for (const field in errors) {
    const issues = errors[field]!;
    const issue = issues[0];
    if (issue !== undefined) output[field] = translate(issue.message.key, issue.message.parameters);
  }
  return Object.freeze(output);
}
