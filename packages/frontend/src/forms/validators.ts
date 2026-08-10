import type { FieldValidator, FormValue, FormValidator, ValidatorApi } from "./types";

const field = <T extends FormValue>(
  kind: string,
  message: string,
  validate: (value: T) => boolean,
  constraint?: FieldValidator<T>["constraint"],
): FieldValidator<T> => Object.freeze({
  scope: "field", kind, message, validate,
  ...(constraint === undefined ? {} : { constraint: Object.freeze(constraint) }),
});

const finiteInteger = (value: number, name: string): number => {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${name} must be a non-negative safe integer.`);
  return value;
};
const finiteNumber = (value: number, name: string): number => {
  if (!Number.isFinite(value)) throw new RangeError(`${name} must be finite.`);
  return value;
};
const empty = (value: FormValue): boolean => value === null || value === "" || value === false ||
  (Array.isArray(value) && value.length === 0);
const regexSource = (input: RegExp | string): string => {
  const source = typeof input === "string" ? input : input.source;
  if (source.length === 0) throw new RangeError("Pattern must not be empty.");
  return source;
};

/** Immutable native-first validator factory used by FormBuilder callbacks. */
export const validators: ValidatorApi = Object.freeze({
  required: <T extends FormValue>(message = "This field is required.") =>
    field<T>("required", message, (value) => !empty(value), { required: true }),
  string: (message = "Enter a valid value.") =>
    field<string>("string", message, (value) => typeof value === "string"),
  email: (message = "Enter a valid email address.") =>
    field<string>("email", message, (value) => value === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value), { type: "email" }),
  number: (message = "Enter a valid number.") =>
    field<number | string>("number", message, (value) => value === "" || Number.isFinite(typeof value === "number" ? value : Number(value)), { type: "number" }),
  boolean: (message = "Enter a valid boolean value.") =>
    field<boolean>("boolean", message, (value) => typeof value === "boolean"),
  minLength: (length: number, message = `Enter at least ${length} characters.`) => {
    const limit = finiteInteger(length, "Minimum length");
    return field<string>("minLength", message, (value) => value === "" || value.length >= limit, { minLength: limit });
  },
  maxLength: (length: number, message = `Enter no more than ${length} characters.`) => {
    const limit = finiteInteger(length, "Maximum length");
    return field<string>("maxLength", message, (value) => value.length <= limit, { maxLength: limit });
  },
  min: (minimum: number, message = `Enter a value of at least ${minimum}.`) => {
    const limit = finiteNumber(minimum, "Minimum");
    return field<number | string>("min", message, (value) => value === "" || Number(value) >= limit, { min: limit });
  },
  max: (maximum: number, message = `Enter a value no greater than ${maximum}.`) => {
    const limit = finiteNumber(maximum, "Maximum");
    return field<number | string>("max", message, (value) => value === "" || Number(value) <= limit, { max: limit });
  },
  pattern: (pattern: RegExp | string, message = "Enter a value in the required format.") => {
    const source = regexSource(pattern);
    const expression = new RegExp(`^(?:${source})$`, typeof pattern === "string" ? "u" : pattern.flags.replaceAll("g", "").replaceAll("y", ""));
    return field<string>("pattern", message, (value) => value === "" || expression.test(value), { pattern: source });
  },
  match: <T extends Readonly<Record<string, FormValue>>, K extends keyof T & string>(first: K, second: K, message = "Values do not match."): FormValidator<T> =>
    Object.freeze({ scope: "form", kind: "match", validate: (value: T) => Object.is(value[first], value[second]) ? null : Object.freeze({ field: second, message }) }),
  form: <T extends Readonly<Record<string, FormValue>>, K extends keyof T & string>(predicate: (value: T) => boolean, options: Readonly<{ field?: K; message: string }>): FormValidator<T> =>
    Object.freeze({ scope: "form", kind: "form", validate: (value: T) => predicate(value) ? null : Object.freeze({ ...(options.field === undefined ? {} : { field: options.field }), message: options.message }) }),
});
