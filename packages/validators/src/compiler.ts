import * as z from "zod";
import { resolveAliasedSection } from "./definition";
import { ValidatorError, ValidatorErrorCode } from "./errors";
import { applyKeyMap, validateKeyMap } from "./mapping";
import { issueMessage } from "./messages";
import type {
  CompiledValidator, RequestValidator, RuleShape, ValidationErrorHandler, ValidationErrors, ValidationInput,
  ValidationIssue, ValidationResult, ValidationSource,
} from "./types";

const SECTIONS = Object.freeze([
  ["rules", "body", "bodySchema", "value", 1 << 0],
  ["queryRules", "query", "querySchema", "query", 1 << 1],
  ["pathRules", "path", "pathSchema", "path", 1 << 2],
  ["headerRules", "headers", "headerSchema", "headers", 1 << 3],
  ["cookieRules", "cookies", "cookieSchema", "cookies", 1 << 4],
  ["messageRules", "message", "messageSchema", "message", 1 << 5],
  ["metadataRules", "metadata", "metadataSchema", "metadata", 1 << 6],
] as const);
export const ValidatorSourceFlag = Object.freeze({
  BODY: 1 << 0, QUERY: 1 << 1, PATH: 1 << 2, HEADERS: 1 << 3,
  COOKIES: 1 << 4, MESSAGE: 1 << 5, METADATA: 1 << 6,
});
type SchemaProperty = typeof SECTIONS[number][2];
const selectedHeaderKeys = new WeakMap<z.ZodType, readonly string[]>();

export function compileValidator<T extends RequestValidator>(definition: T, id = 0): CompiledValidator {
  if (!isRecord(definition) || !Number.isSafeInteger(id) || id < 0) throw new ValidatorError(ValidatorErrorCode.INVALID_DEFINITION, "Validator definition or ID is invalid.");
  const allowed = new Set(["rules", "bodyRules", "queryRules", "pathRules", "paramRules", "headerRules", "cookieRules", "messageRules", "metadataRules", "mapV", "mapK", "onValidationError"]);
  if (Object.keys(definition).some((key) => !allowed.has(key))) throw new ValidatorError(ValidatorErrorCode.INVALID_DEFINITION, "Validator definition contains an unknown property.");
  const normalized = {
    rules: resolveAliasedSection(definition.bodyRules as RuleShape | undefined, definition.rules as RuleShape | undefined, "bodyRules", "rules"),
    queryRules: definition.queryRules as RuleShape | undefined,
    pathRules: resolveAliasedSection(definition.paramRules as RuleShape | undefined, definition.pathRules as RuleShape | undefined, "paramRules", "pathRules"),
    headerRules: definition.headerRules as RuleShape | undefined,
    cookieRules: definition.cookieRules as RuleShape | undefined,
    messageRules: definition.messageRules as RuleShape | undefined,
    metadataRules: definition.metadataRules as RuleShape | undefined,
  };
  const schemas: Partial<Record<SchemaProperty, z.ZodType>> = {};
  let flags = 0;
  for (const [definitionKey, , schemaKey, , flag] of SECTIONS) {
    const shape = normalized[definitionKey];
    if (shape === undefined) continue;
    const schema = compileShape(shape, definitionKey === "headerRules");
    schemas[schemaKey] = schema;
    if (definitionKey === "headerRules") selectedHeaderKeys.set(schema, Object.freeze(Object.keys(shape).map((key) => key.toLowerCase())));
    flags |= flag;
  }
  if (flags === 0) throw new ValidatorError(ValidatorErrorCode.INVALID_RULES, "Validator must define at least one rule section.");
  if (definition.mapV !== undefined && typeof definition.mapV !== "function") throw new ValidatorError(ValidatorErrorCode.INVALID_DEFINITION, "mapV must be synchronous function.");
  if (definition.onValidationError !== undefined && typeof definition.onValidationError !== "function") throw new ValidatorError(ValidatorErrorCode.INVALID_DEFINITION, "onValidationError must be a function.");
  const knownKeys = new Set(Object.keys(normalized.rules ?? {}));
  const keyMap = definition.mapK === undefined ? undefined : validateKeyMap(definition.mapK, definition.mapV === undefined ? knownKeys : undefined);
  const compiledBase = {
    id, flags, ...schemas,
    ...(definition.mapV === undefined ? {} : { mapValue: definition.mapV as (value: Readonly<Record<string, unknown>>) => unknown }),
    ...(keyMap === undefined ? {} : { keyMap }),
    ...(definition.onValidationError === undefined ? {} : { onValidationError: definition.onValidationError as ValidationErrorHandler }),
  };
  const compiled: CompiledValidator = Object.freeze({
    ...compiledBase,
    execute(input: ValidationInput): ValidationResult {
      return executeCompiled(compiled, input);
    },
  });
  return compiled;
}

function compileShape(shape: RuleShape, normalizeHeaders: boolean): z.ZodType {
  if (!isRecord(shape) || Object.keys(shape).length === 0) throw new ValidatorError(ValidatorErrorCode.INVALID_RULES, "Rule sections must be non-empty objects.");
  const target: Record<string, z.ZodType> = Object.create(null);
  for (const [rawKey, schema] of Object.entries(shape)) {
    const key = normalizeHeaders ? rawKey.toLowerCase() : rawKey;
    if (!safeKey(key) || !isZodSchema(schema) || target[key] !== undefined) throw new ValidatorError(ValidatorErrorCode.INVALID_RULES, "Rule section contains an invalid key or schema.");
    target[key] = schema;
  }
  try { return z.strictObject(target); }
  catch (cause) { throw new ValidatorError(ValidatorErrorCode.SCHEMA_COMPILATION_FAILED, "Zod schema compilation failed.", { cause }); }
}

function executeCompiled(compiled: CompiledValidator, input: ValidationInput): ValidationResult {
  if (!isRecord(input)) throw new ValidatorError(ValidatorErrorCode.TRANSPORT_INPUT_INVALID, "Validation input must be an object.");
  const successes: Partial<Record<ValidationSource | "value", unknown>> = {};
  const grouped: Record<string, ValidationIssue[]> = Object.create(null);
  for (const [, source, schemaKey, inputKey] of SECTIONS) {
    const schema = compiled[schemaKey];
    if (schema === undefined) continue;
    const raw = input[inputKey];
    const candidate = source === "headers" ? normalizeHeaderRecord(raw, selectedHeaderKeys.get(schema) ?? Object.freeze([])) : raw;
    let parsed: z.ZodSafeParseResult<unknown>;
    try { parsed = schema.safeParse(candidate); }
    catch (cause) {
      throw new ValidatorError(
        isAsyncSchemaError(cause) ? ValidatorErrorCode.ASYNC_SCHEMA_MISMATCH : ValidatorErrorCode.VALIDATION_FAILED,
        isAsyncSchemaError(cause) ? "Schema requires explicit asynchronous validation." : "Zod validation execution failed.",
        { cause },
      );
    }
    if (parsed.success) successes[inputKey] = parsed.data;
    else collectIssues(grouped, source, parsed.error.issues, candidate);
  }
  if (Object.keys(grouped).length > 0) return Object.freeze({ valid: false, errors: freezeErrors(grouped) });
  let value = successes.value;
  if (compiled.mapValue !== undefined) {
    const mapped = compiled.mapValue(asRecord(value));
    if (isThenable(mapped)) throw new ValidatorError(ValidatorErrorCode.ASYNC_SCHEMA_MISMATCH, "mapV must remain synchronous.");
    value = mapped;
  }
  if (compiled.keyMap !== undefined) {
    validateKeyMap(compiled.keyMap, new Set(Object.keys(asRecord(value))));
    value = applyKeyMap(value, compiled.keyMap);
  }
  const result: Record<string, unknown> = { valid: true, value };
  for (const key of ["query", "path", "headers", "cookies", "message", "metadata"] as const) if (key in successes) result[key] = successes[key];
  return Object.freeze(result) as ValidationResult;
}

function collectIssues(target: Record<string, ValidationIssue[]>, source: ValidationSource, issues: readonly z.core.$ZodIssue[], input: unknown): void {
  for (const issue of issues) {
    const path = Object.freeze([...issue.path]);
    const fieldPath = path.map(String).join(".");
    const field = fieldPath.length === 0 ? source : fieldPath;
    const group = `${source}.${field}`;
    const issueInput = valueAtPath(input, path);
    const normalized = Object.freeze({
      source, path, field, code: issue.code,
      message: issueMessage(issue, issueInput),
    }) satisfies ValidationIssue;
    (target[group] ??= []).push(normalized);
  }
}
function freezeErrors(input: Record<string, ValidationIssue[]>): ValidationErrors {
  const output: Record<string, readonly ValidationIssue[]> = Object.create(null);
  for (const [field, issues] of Object.entries(input)) output[field] = Object.freeze(issues);
  return Object.freeze(output);
}
function valueAtPath(value: unknown, path: readonly PropertyKey[]): unknown {
  let current = value;
  for (const segment of path) {
    if (typeof current !== "object" || current === null) return undefined;
    current = Reflect.get(current, segment);
  }
  return current;
}
function normalizeHeaderRecord(value: unknown, selected: readonly string[]): unknown {
  if (!isRecord(value)) return value;
  const normalized: Record<string, unknown> = Object.create(null);
  for (const [key, item] of Object.entries(value)) normalized[key.toLowerCase()] = item;
  const result: Record<string, unknown> = Object.create(null);
  for (const key of selected) {
    const item = normalized[key];
    if (item !== undefined) result[key] = item;
  }
  return result;
}
function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (!isRecord(value)) throw new ValidatorError(ValidatorErrorCode.INVALID_KEY_MAPPING, "Value mapping requires an object body.");
  return value;
}
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function isZodSchema(value: unknown): value is z.ZodType { return value instanceof z.ZodType; }
function safeKey(value: string): boolean { return value.length > 0 && value !== "__proto__" && value !== "prototype" && value !== "constructor"; }
function isThenable(value: unknown): value is PromiseLike<unknown> { return typeof value === "object" && value !== null && "then" in value && typeof value.then === "function"; }
function isAsyncSchemaError(value: unknown): boolean {
  return value instanceof Error && (value.name.includes("Async") || value.message.toLowerCase().includes("promise"));
}
