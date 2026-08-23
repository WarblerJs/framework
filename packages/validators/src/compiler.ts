import { isWarblerField, type AnyField, type FieldSpec, type PresenceOp, type PriceOptions, type RuleOp, type RuleShape, type SerialOptions } from "./builder";
import { validateOptions, validatorStages, type ValidatorStages } from "./definition";
import { ValidatorError, ValidatorErrorCode } from "./errors";
import { applyKeyMap, validateKeyMap } from "./mapping";
import { issueParameters, validationMessage } from "./messages";
import type { CompiledValidator, MaybePromise, ValidationErrorHandler, ValidationErrors, ValidationInput, ValidationIssue, ValidationResult, ValidationSource } from "./types";

const SOURCE_DEFINITIONS = Object.freeze([
  Object.freeze({ definitionKey: "bodyRules", source: "body", inputKey: "value", flag: 1 << 0 }),
  Object.freeze({ definitionKey: "queryRules", source: "query", inputKey: "query", flag: 1 << 1 }),
  Object.freeze({ definitionKey: "paramRules", source: "path", inputKey: "path", flag: 1 << 2 }),
  Object.freeze({ definitionKey: "headerRules", source: "headers", inputKey: "headers", flag: 1 << 3 }),
  Object.freeze({ definitionKey: "cookieRules", source: "cookies", inputKey: "cookies", flag: 1 << 4 }),
  Object.freeze({ definitionKey: "messageRules", source: "message", inputKey: "message", flag: 1 << 5 }),
  Object.freeze({ definitionKey: "metadataRules", source: "metadata", inputKey: "metadata", flag: 1 << 6 }),
] as const);
export const ValidatorSourceFlag = Object.freeze({ BODY: 1 << 0, QUERY: 1 << 1, PATH: 1 << 2, HEADERS: 1 << 3, COOKIES: 1 << 4, MESSAGE: 1 << 5, METADATA: 1 << 6 });
interface CompiledField {
  readonly key: string; readonly outputKey: string; readonly spec: FieldSpec<unknown>;
  readonly nested?: SourcePlan; readonly item?: CompiledField; readonly price?: CompiledPriceOptions; readonly serial?: CompiledSerialOptions;
  readonly rules: readonly CompiledRule[]; readonly presence: readonly PresenceOp[];
  readonly rejectIf: readonly Readonly<{ readonly predicate: (value: unknown) => boolean | Promise<boolean>; readonly message?: string }>[];
  readonly maps: readonly ((value: unknown) => unknown)[];
}
interface SourcePlan { readonly source: ValidationSource; readonly inputKey: keyof ValidationInput; readonly fields: readonly CompiledField[]; readonly keys: ReadonlySet<string>; readonly allowedKeys: ReadonlySet<string>; readonly headerKeys?: readonly string[] }
interface RootBodyPlan { readonly source: "body"; readonly inputKey: "value"; readonly field: CompiledField }
interface CompiledPlan {
  readonly id: number; readonly flags: number; readonly sources: readonly SourcePlan[]; readonly rootBody?: RootBodyPlan;
  readonly legacyMapValue?: (value: Readonly<Record<string, unknown>>) => unknown; readonly legacyKeyMap?: Readonly<Record<string, string>>;
  readonly stages?: ValidatorStages; readonly concurrency: number; readonly onValidationError?: ValidationErrorHandler;
}
interface CompiledPriceOptions { readonly decimals: number; readonly allowString: boolean; readonly allowNegative: boolean; readonly decimalSeparator: "." | ","; readonly normalize: "string" | "minor-unit"; readonly min?: bigint; readonly max?: bigint }
interface CompiledSerialOptions { readonly pattern: RegExp }
type CompiledRule = RuleOp | Readonly<{ readonly op: "priceComparison"; readonly comparison: "gt" | "gte" | "lt" | "lte"; readonly value: bigint; readonly message?: string }> | Readonly<{ readonly op: "priceBetween"; readonly min: bigint; readonly max: bigint; readonly message?: string }>;
type ParseResult = Readonly<{ readonly ok: true; readonly value: unknown; readonly priceMinor?: bigint }> | Readonly<{ readonly ok: false; readonly code: string; readonly message: string; readonly allowed?: IssueValue; readonly entered?: IssueValue }>;
type IssueValue = number | string | boolean | bigint | null;
type RuleFailure = Readonly<{ readonly code: string; readonly message: string; readonly allowed?: IssueValue; readonly entered?: IssueValue }>;
const DEFAULT_CONCURRENCY = 8;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/u;
const CUID = /^c[^\s-]{8,}$/u;
const NANOID = /^[A-Za-z0-9_-]{21}$/u;

export function compileValidator<T extends object>(definition: T, id = 0): CompiledValidator {
  if (!isRecord(definition) || !Number.isSafeInteger(id) || id < 0) throw new ValidatorError(ValidatorErrorCode.INVALID_DEFINITION, "Validator definition or ID is invalid.");
  validateKnownDefinition(definition);
  const bodyShape = resolveBodyRules(definition);
  const pathShape = resolvePathRules(definition);
  if (definition.bodyRule !== undefined && bodyShape !== undefined) throw new ValidatorError(ValidatorErrorCode.INVALID_ROOT_BODY, "bodyRule cannot be combined with bodyRules or rules.");
  const normalized = Object.freeze({
    bodyRules: bodyShape, queryRules: definition.queryRules as RuleShape | undefined, paramRules: pathShape,
    headerRules: definition.headerRules as RuleShape | undefined, cookieRules: definition.cookieRules as RuleShape | undefined,
    messageRules: definition.messageRules as RuleShape | undefined, metadataRules: definition.metadataRules as RuleShape | undefined,
  });
  const sources: SourcePlan[] = [];
  let flags = 0;
  const sourceTotal = SOURCE_DEFINITIONS.length;
  for (let index = 0; index < sourceTotal; index += 1) {
    const source = SOURCE_DEFINITIONS[index]!;
    const shape = normalized[source.definitionKey];
    if (shape === undefined) continue;
    sources.push(compileSource(shape, source.source, source.inputKey, source.source === "headers"));
    flags |= source.flag;
  }
  let rootBody: RootBodyPlan | undefined;
  if (definition.bodyRule !== undefined) {
    if (!isWarblerField(definition.bodyRule)) throw new ValidatorError(ValidatorErrorCode.INVALID_ROOT_BODY, "bodyRule must be a Warbler validator field.");
    rootBody = Object.freeze({ source: "body" as const, inputKey: "value" as const, field: compileField("$body", definition.bodyRule) });
    flags |= ValidatorSourceFlag.BODY;
  }
  if (flags === 0) throw new ValidatorError(ValidatorErrorCode.INVALID_RULES, "Validator must define at least one rule section.");
  if (definition.mapV !== undefined && typeof definition.mapV !== "function") throw new ValidatorError(ValidatorErrorCode.INVALID_DEFINITION, "mapV must be a function.");
  if (definition.onValidationError !== undefined && typeof definition.onValidationError !== "function") throw new ValidatorError(ValidatorErrorCode.INVALID_DEFINITION, "onValidationError must be a function.");
  const knownKeys = new Set<string>();
  if (bodyShape !== undefined) {
    const bodyKeys = Object.keys(bodyShape);
    const total = bodyKeys.length;
    for (let index = 0; index < total; index += 1) knownKeys.add(bodyKeys[index]!);
  }
  const keyMap = definition.mapK === undefined ? undefined : validateKeyMap(definition.mapK as Readonly<Record<string, string>>, definition.mapV === undefined ? knownKeys : undefined);
  const stages = validatorStages(definition);
  validateOptions(stages?.options ?? Object.freeze({}));
  const plan: CompiledPlan = Object.freeze({
    id, flags, sources: Object.freeze(sources), ...(rootBody === undefined ? {} : { rootBody }),
    ...(definition.mapV === undefined ? {} : { legacyMapValue: definition.mapV as (value: Readonly<Record<string, unknown>>) => unknown }),
    ...(keyMap === undefined ? {} : { legacyKeyMap: keyMap }), ...(stages === undefined ? {} : { stages }),
    concurrency: stages?.options?.asyncConcurrency ?? DEFAULT_CONCURRENCY,
    ...(definition.onValidationError === undefined ? {} : { onValidationError: definition.onValidationError as ValidationErrorHandler }),
  });
  return Object.freeze({ id, flags, ...(plan.onValidationError === undefined ? {} : { onValidationError: plan.onValidationError }), execute(input: ValidationInput): MaybePromise<ValidationResult> { return executePlan(plan, input); } });
}
function validateKnownDefinition(definition: Readonly<Record<string, unknown>>): void {
  const allowed = new Set(["bodyRule", "rules", "bodyRules", "queryRules", "pathRules", "paramRules", "paramsRules", "headerRules", "cookieRules", "messageRules", "metadataRules", "mapV", "mapK", "onValidationError", "csrf", "after", "patch", "map"]);
  const keys = Object.keys(definition);
  const total = keys.length;
  for (let index = 0; index < total; index += 1) if (!allowed.has(keys[index]!)) throw new ValidatorError(ValidatorErrorCode.INVALID_DEFINITION, "Validator definition contains an unknown property.");
}
function resolveBodyRules(definition: Readonly<Record<string, unknown>>): RuleShape | undefined {
  if (definition.bodyRules !== undefined && definition.rules !== undefined) throw new ValidatorError(ValidatorErrorCode.INVALID_DEFINITION, "Validator definition cannot specify both \"bodyRules\" and \"rules\".");
  return (definition.bodyRules ?? definition.rules) as RuleShape | undefined;
}
function resolvePathRules(definition: Readonly<Record<string, unknown>>): RuleShape | undefined {
  const paramRules = definition.paramRules as RuleShape | undefined;
  const paramsRules = definition.paramsRules as RuleShape | undefined;
  const pathRules = definition.pathRules as RuleShape | undefined;
  const count = (paramRules === undefined ? 0 : 1) + (paramsRules === undefined ? 0 : 1) + (pathRules === undefined ? 0 : 1);
  if (count > 1) throw new ValidatorError(ValidatorErrorCode.INVALID_DEFINITION, "Validator definition cannot specify more than one of \"paramRules\", \"paramsRules\", or \"pathRules\".");
  return paramRules ?? paramsRules ?? pathRules;
}
function compileSource(shape: RuleShape, source: ValidationSource, inputKey: keyof ValidationInput, normalizeHeaders: boolean): SourcePlan {
  if (!isRecord(shape)) throw new ValidatorError(ValidatorErrorCode.INVALID_RULES, "Rule sections must be objects.");
  const names = Object.keys(shape);
  const total = names.length;
  if (total === 0) throw new ValidatorError(ValidatorErrorCode.INVALID_RULES, "Rule sections must be non-empty objects.");
  const fields = new Array<CompiledField>(total);
  const keys = new Set<string>();
  const allowedKeys = new Set<string>();
  const outputs = new Set<string>();
  const headerKeys = normalizeHeaders ? new Array<string>() : undefined;
  for (let index = 0; index < total; index += 1) {
    const rawKey = names[index]!;
    const key = normalizeHeaders ? rawKey.toLowerCase() : rawKey;
    if (headerKeys !== undefined) headerKeys.push(key);
    const value = shape[rawKey];
    if (!safeKey(key) || !isWarblerField(value) || keys.has(key)) throw new ValidatorError(ValidatorErrorCode.INVALID_RULES, "Rule section contains an invalid key or field validator.");
    const field = compileField(key, value);
    collectPresenceKeys(field, allowedKeys, normalizeHeaders);
    if (headerKeys !== undefined) collectHeaderPresenceKeys(field, headerKeys);
    if (outputs.has(field.outputKey) || (field.outputKey !== key && keys.has(field.outputKey))) throw new ValidatorError(ValidatorErrorCode.DUPLICATE_MAPPED_KEY, `Mapped target "${field.outputKey}" already exists.`);
    keys.add(key); allowedKeys.add(key); outputs.add(field.outputKey); fields[index] = field;
  }
  validatePresence(fields, keys);
  return Object.freeze({ source, inputKey, fields: Object.freeze(fields), keys: Object.freeze(keys), allowedKeys: Object.freeze(allowedKeys), ...(headerKeys === undefined ? {} : { headerKeys: Object.freeze(headerKeys) }) });
}
function collectPresenceKeys(field: CompiledField, output: Set<string>, normalize: boolean): void {
  const presence = field.presence;
  const total = presence.length;
  for (let index = 0; index < total; index += 1) {
    const rule = presence[index]!;
    if (rule.op === "requiredWhen") output.add(normalize ? rule.field.toLowerCase() : rule.field);
    else {
      const fields = rule.fields;
      const fieldTotal = fields.length;
      for (let fieldIndex = 0; fieldIndex < fieldTotal; fieldIndex += 1) output.add(normalize ? fields[fieldIndex]!.toLowerCase() : fields[fieldIndex]!);
    }
  }
}
function collectHeaderPresenceKeys(field: CompiledField, output: string[]): void {
  const presence = field.presence;
  const total = presence.length;
  for (let index = 0; index < total; index += 1) {
    const rule = presence[index]!;
    if (rule.op === "requiredWhen") output.push(rule.field.toLowerCase());
    else {
      const fields = rule.fields;
      const fieldTotal = fields.length;
      for (let fieldIndex = 0; fieldIndex < fieldTotal; fieldIndex += 1) output.push(fields[fieldIndex]!.toLowerCase());
    }
  }
}
function compileField(key: string, field: AnyField): CompiledField {
  const spec = field.__warblerSpec;
  validateFieldSpec(spec);
  const nested = spec.shape === undefined ? undefined : compileSource(spec.shape, "body", "value", false);
  const item = spec.item === undefined ? undefined : compileField("$item", spec.item);
  const outputKey = spec.keyMap ?? key;
  if (!safeKey(outputKey)) throw new ValidatorError(ValidatorErrorCode.UNSAFE_MAPPED_KEY, "Unsafe mapped key.");
  return Object.freeze({
    key, outputKey, spec, ...(nested === undefined ? {} : { nested }), ...(item === undefined ? {} : { item }),
    ...(spec.price === undefined ? {} : { price: compilePriceOptions(spec.price) }), ...(spec.serial === undefined ? {} : { serial: compileSerialOptions(spec.serial) }),
    rules: Object.freeze(compileRules(spec.rules, spec.price)), presence: spec.presence,
    rejectIf: spec.rejectIf as readonly Readonly<{ readonly predicate: (value: unknown) => boolean | Promise<boolean>; readonly message?: string }>[], maps: spec.maps,
  });
}
function validateFieldSpec(spec: FieldSpec<unknown>): void {
  const rules = spec.rules;
  const total = rules.length;
  for (let index = 0; index < total; index += 1) {
    const rule = rules[index]!;
    if (rule.op === "regex" && (rule.value.global || rule.value.sticky)) throw new ValidatorError(ValidatorErrorCode.INVALID_RULES, "Stateful regex validators with g/y flags are not allowed.");
  }
}
function compileRules(rules: readonly RuleOp[], priceOptions: PriceOptions | undefined): readonly CompiledRule[] {
  if (priceOptions === undefined) return rules;
  const price = compilePriceOptions(priceOptions);
  const output: CompiledRule[] = [];
  const total = rules.length;
  for (let index = 0; index < total; index += 1) {
    const rule = rules[index]!;
    if (rule.op === "gt" || rule.op === "gte" || rule.op === "lt" || rule.op === "lte") output.push(Object.freeze({ op: "priceComparison", comparison: rule.op, value: parsePriceConfig(rule.value, price), ...(rule.message === undefined ? {} : { message: rule.message }) }));
    else if (rule.op === "between") output.push(Object.freeze({ op: "priceBetween", min: parsePriceConfig(rule.min, price), max: parsePriceConfig(rule.max, price), ...(rule.message === undefined ? {} : { message: rule.message }) }));
    else output.push(rule);
  }
  return Object.freeze(output);
}
function compilePriceOptions(options: PriceOptions): CompiledPriceOptions {
  const decimals = options.decimals ?? options.scale ?? 2;
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 12) throw new ValidatorError(ValidatorErrorCode.INVALID_PRICE_CONFIG, "Price decimals must be an integer between 0 and 12.");
  const base = Object.freeze({ decimals, allowString: options.allowString ?? true, allowNegative: options.allowNegative ?? false, decimalSeparator: options.decimalSeparator ?? ".", normalize: options.normalize ?? "string" });
  return Object.freeze({ ...base, ...(options.min === undefined ? {} : { min: parsePriceConfig(options.min, base) }), ...(options.max === undefined ? {} : { max: parsePriceConfig(options.max, base) }) });
}
function compileSerialOptions(options: SerialOptions): CompiledSerialOptions {
  if (!Number.isInteger(options.digits) || options.digits <= 0 || options.digits > 64) throw new ValidatorError(ValidatorErrorCode.INVALID_DEFINITION, "Serial digits must be a positive integer.");
  const prefix = options.prefix === undefined ? "" : escapeRegex(options.prefix);
  const separator = options.separator === undefined ? "" : escapeRegex(options.separator);
  return Object.freeze({ pattern: new RegExp(`^${prefix}${separator}\\d{${options.digits}}$`, "u") });
}
function validatePresence(fields: readonly CompiledField[], keys: ReadonlySet<string>): void {
  const total = fields.length;
  for (let index = 0; index < total; index += 1) {
    const field = fields[index]!;
    const presence = field.presence;
    const presenceTotal = presence.length;
    for (let presenceIndex = 0; presenceIndex < presenceTotal; presenceIndex += 1) {
      const rule = presence[presenceIndex]!;
      if (rule.op === "requiredWhen") {
        if (!safeKey(rule.field) || rule.field === field.key) throw new ValidatorError(ValidatorErrorCode.INVALID_PRESENCE_DEPENDENCY, "Invalid requiredWhen dependency.");
      } else {
        const deps = rule.fields;
        const depTotal = deps.length;
        if (depTotal === 0) throw new ValidatorError(ValidatorErrorCode.INVALID_PRESENCE_DEPENDENCY, "Presence dependency list cannot be empty.");
        for (let depIndex = 0; depIndex < depTotal; depIndex += 1) {
          const dep = deps[depIndex]!;
          if (!safeKey(dep) || dep === field.key) throw new ValidatorError(ValidatorErrorCode.INVALID_PRESENCE_DEPENDENCY, "Invalid presence dependency.");
        }
      }
    }
  }
}
interface ExecutionState { grouped: Record<string, ValidationIssue[]> | undefined; sections: Record<string, unknown>; reject: readonly RejectJob[] | undefined }
interface RejectJob { readonly source: ValidationSource; readonly field: CompiledField; readonly value: unknown; readonly path: readonly PropertyKey[] }
function executePlan(plan: CompiledPlan, input: ValidationInput): MaybePromise<ValidationResult> {
  if (!isRecord(input)) throw new ValidatorError(ValidatorErrorCode.TRANSPORT_INPUT_INVALID, "Validation input must be an object.");
  const state: ExecutionState = { grouped: undefined, sections: Object.create(null), reject: undefined };
  if (plan.rootBody !== undefined) executeRootBody(plan.rootBody, input, state);
  const sources = plan.sources;
  const total = sources.length;
  for (let index = 0; index < total; index += 1) executeSource(sources[index]!, input, state);
  if (state.grouped !== undefined) return invalid(state.grouped);
  const rejected = executeRejectIf(plan, state);
  if (isThenable(rejected)) return rejected.then((hasIssues) => hasIssues ? invalid(state.grouped!) : executeStagesAndMappings(plan, state));
  return rejected ? invalid(state.grouped!) : executeStagesAndMappings(plan, state);
}
function executeRootBody(plan: RootBodyPlan, input: ValidationInput, state: ExecutionState): void {
  const parsed = parseField(plan.field, input.value, plan.source, Object.freeze([]), state);
  if (parsed.ok) state.sections.value = parsed.value;
}
function executeSource(plan: SourcePlan, input: ValidationInput, state: ExecutionState): void {
  const raw = input[plan.inputKey];
  const candidate = plan.source === "headers" ? normalizeHeaderRecord(raw, plan.headerKeys ?? Object.freeze([])) : raw;
  if (!isRecord(candidate)) {
    const output = Object.freeze(Object.create(null) as Record<string, unknown>);
    const fields = plan.fields;
    const total = fields.length;
    for (let index = 0; index < total; index += 1) {
      const field = fields[index]!;
      if (!isEffectivelyOptional(field)) addIssue(state, plan.source, Object.freeze([field.key]), field.key, "required", field.spec.message ?? "validators.required", undefined, undefined);
    }
    state.sections[plan.inputKey] = output;
    return;
  }
  const output: Record<string, unknown> = Object.create(null);
  for (const key in candidate) if (!plan.allowedKeys.has(key)) addIssue(state, plan.source, Object.freeze([key]), key, "unrecognized_key", "validators.unrecognized", undefined, key);
  const fields = plan.fields;
  const total = fields.length;
  for (let index = 0; index < total; index += 1) {
    const field = fields[index]!;
    if (!hasOwn(candidate, field.key)) {
      if (!isEffectivelyOptional(field)) addIssue(state, plan.source, Object.freeze([field.key]), field.key, "required", field.spec.message ?? "validators.required", undefined, undefined);
      continue;
    }
    const parsed = parseField(field, candidate[field.key], plan.source, Object.freeze([field.key]), state);
    if (parsed.ok) output[field.key] = parsed.value;
  }
  evaluatePresence(plan, candidate, output, state);
  state.sections[plan.inputKey] = Object.freeze(output);
}
function parseField(field: CompiledField, raw: unknown, source: ValidationSource, path: readonly PropertyKey[], state: ExecutionState): ParseResult {
  if (raw === null) {
    if (field.spec.nullable) return Object.freeze({ ok: true, value: null });
    addIssue(state, source, path, fieldName(source, path), "invalid_type", field.spec.message ?? "validators.invalid", "non-null", "null");
    return Object.freeze({ ok: false, code: "invalid_type", message: field.spec.message ?? "validators.invalid" });
  }
  const parsed = parseKind(field, raw, source, path, state);
  if (!parsed.ok) {
    addIssue(state, source, path, fieldName(source, path), parsed.code, parsed.message, parsed.allowed, parsed.entered);
    return parsed;
  }
  let value = parsed.value;
  const rules = field.rules;
  const total = rules.length;
  for (let index = 0; index < total; index += 1) {
    const rule = rules[index]!;
    if (rule.op === "trim") {
      value = typeof value === "string" ? value.trim() : value;
      continue;
    }
    const failed = checkRule(rule, value, parsed.priceMinor);
    if (failed !== undefined) {
      addIssue(state, source, path, fieldName(source, path), failed.code, failed.message, failed.allowed, failed.entered);
      return Object.freeze({ ok: false, code: failed.code, message: failed.message });
    }
  }
  collectRejectJob(state, source, field, value, path);
  return Object.freeze({ ok: true, value, ...(parsed.priceMinor === undefined ? {} : { priceMinor: parsed.priceMinor }) });
}
function parseKind(field: CompiledField, raw: unknown, source: ValidationSource, path: readonly PropertyKey[], state: ExecutionState): ParseResult {
  const kind = field.spec.kind;
  if (kind === "string" || kind === "email" || kind === "uuid" || kind === "ulid" || kind === "cuid" || kind === "nanoid" || kind === "serial") {
    if (typeof raw !== "string") return fail(field, "invalid_type", "string", typeName(raw));
    if (kind === "email" && !EMAIL.test(raw)) return fail(field, "invalid_string", "email", raw.length);
    if (kind === "uuid" && !UUID.test(raw)) return fail(field, "invalid_string", "uuid", raw.length);
    if (kind === "ulid" && !ULID.test(raw)) return fail(field, "invalid_string", "ulid", raw.length);
    if (kind === "cuid" && !CUID.test(raw)) return fail(field, "invalid_string", "cuid", raw.length);
    if (kind === "nanoid" && !NANOID.test(raw)) return fail(field, "invalid_string", "nanoid", raw.length);
    if (kind === "serial" && field.serial !== undefined && !field.serial.pattern.test(raw)) return fail(field, "invalid_string", "serial", raw.length);
    return Object.freeze({ ok: true, value: raw });
  }
  if (kind === "number") return parseNumber(raw, field);
  if (kind === "boolean") return parseBoolean(raw, field);
  if (kind === "date") return parseDate(raw, field);
  if (kind === "price") return parsePrice(raw, field);
  if (kind === "file") return raw instanceof File ? Object.freeze({ ok: true, value: raw }) : fail(field, "invalid_type", "file", typeName(raw));
  if (kind === "object") return parseObject(field, raw, source, path, state);
  if (kind === "array") return parseArray(field, raw, source, path, state);
  return fail(field, "invalid_type", kind, typeName(raw));
}
function parseObject(field: CompiledField, raw: unknown, source: ValidationSource, path: readonly PropertyKey[], state: ExecutionState): ParseResult {
  if (!isRecord(raw) || field.nested === undefined) return fail(field, "invalid_type", "object", typeName(raw));
  const output: Record<string, unknown> = Object.create(null);
  const plan = field.nested;
  for (const key in raw) if (!plan.keys.has(key)) addIssue(state, source, appendPath(path, key), pathString(appendPath(path, key)), "unrecognized_key", "validators.unrecognized", undefined, key);
  const fields = plan.fields;
  const total = fields.length;
  for (let index = 0; index < total; index += 1) {
    const nested = fields[index]!;
    if (!hasOwn(raw, nested.key)) {
      if (!isEffectivelyOptional(nested)) addIssue(state, source, appendPath(path, nested.key), pathString(appendPath(path, nested.key)), "required", nested.spec.message ?? "validators.required", undefined, undefined);
      continue;
    }
    const parsed = parseField(nested, raw[nested.key], source, appendPath(path, nested.key), state);
    if (parsed.ok) output[nested.key] = parsed.value;
  }
  return Object.freeze({ ok: true, value: Object.freeze(output) });
}
function parseArray(field: CompiledField, raw: unknown, source: ValidationSource, path: readonly PropertyKey[], state: ExecutionState): ParseResult {
  if (!Array.isArray(raw) || field.item === undefined) return fail(field, "invalid_type", "array", typeName(raw));
  const total = raw.length;
  const output = new Array<unknown>(total);
  for (let index = 0; index < total; index += 1) {
    const parsed = parseField(field.item, raw[index], source, appendPath(path, index), state);
    if (parsed.ok) output[index] = parsed.value;
  }
  return Object.freeze({ ok: true, value: Object.freeze(output) });
}
function parseNumber(raw: unknown, field: CompiledField): ParseResult { const value = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim().length > 0 ? Number(raw) : Number.NaN; return Number.isFinite(value) ? Object.freeze({ ok: true, value }) : fail(field, "invalid_type", "number", typeName(raw)); }
function parseBoolean(raw: unknown, field: CompiledField): ParseResult { if (typeof raw === "boolean") return Object.freeze({ ok: true, value: raw }); if (raw === "true" || raw === "1") return Object.freeze({ ok: true, value: true }); if (raw === "false" || raw === "0") return Object.freeze({ ok: true, value: false }); return fail(field, "invalid_type", "boolean", typeName(raw)); }
function parseDate(raw: unknown, field: CompiledField): ParseResult { const date = raw instanceof Date ? new Date(raw.getTime()) : typeof raw === "string" || typeof raw === "number" ? new Date(raw) : undefined; return date !== undefined && Number.isFinite(date.getTime()) ? Object.freeze({ ok: true, value: date }) : fail(field, "invalid_type", "date", typeName(raw)); }
function parsePrice(raw: unknown, field: CompiledField): ParseResult {
  const options = field.price ?? compilePriceOptions(Object.freeze({}));
  if (typeof raw === "string") {
    if (!options.allowString) return fail(field, "invalid_type", "price", typeName(raw));
  } else if (typeof raw !== "number") return fail(field, "invalid_type", "price", typeName(raw));
  const parsed = parseDecimal(String(raw), options);
  if (!parsed.ok) return fail(field, "invalid_price", "price", typeof raw === "string" ? raw.length : typeName(raw));
  if (options.min !== undefined && parsed.minor < options.min) return fail(field, "too_small", String(options.min), parsed.normalized);
  if (options.max !== undefined && parsed.minor > options.max) return fail(field, "too_big", String(options.max), parsed.normalized);
  return Object.freeze({ ok: true, value: options.normalize === "minor-unit" ? parsed.minor : parsed.normalized, priceMinor: parsed.minor });
}
function checkRule(rule: CompiledRule, value: unknown, priceMinor: bigint | undefined): RuleFailure | undefined {
  if (rule.op === "min" || rule.op === "max" || rule.op === "length") {
    const size = typeof value === "string" || Array.isArray(value) ? value.length : value instanceof File ? value.size : undefined;
    if (size === undefined) return undefined;
    if (rule.op === "min" && size < rule.value) return ruleFailure(rule, "too_small", rule.value, size);
    if (rule.op === "max" && size > rule.value) return ruleFailure(rule, "too_big", rule.value, size);
    if (rule.op === "length" && size !== rule.value) return ruleFailure(rule, "invalid_length", rule.value, size);
    return undefined;
  }
  if (rule.op === "regex") return typeof value === "string" && !rule.value.test(value) ? ruleFailure(rule, "invalid_string", "pattern", value.length) : undefined;
  if (rule.op === "digits") { if (typeof value !== "string" || !/^\d+$/u.test(value)) return ruleFailure(rule, "invalid_string", "digits", typeof value === "string" ? value.length : typeName(value)); if (rule.min !== undefined && value.length < rule.min) return ruleFailure(rule, "too_small", rule.min, value.length); if (rule.max !== undefined && value.length > rule.max) return ruleFailure(rule, "too_big", rule.max, value.length); return undefined; }
  if (typeof value === "number") return checkNumberRule(rule, value);
  if (value instanceof Date) return checkDateRule(rule, value);
  if (value instanceof File) return checkFileRule(rule, value);
  if (rule.op === "in" || rule.op === "notIn") { const found = contains(rule.values, value); return rule.op === "in" && !found ? ruleFailure(rule, "invalid_value", String(rule.values.length), typeName(value)) : rule.op === "notIn" && found ? ruleFailure(rule, "invalid_value", "forbidden", typeName(value)) : undefined; }
  if (rule.op === "equal") return Object.is(value, rule.value) ? undefined : ruleFailure(rule, "invalid_value", String(rule.value), typeName(value));
  if (rule.op === "notEqual") return Object.is(value, rule.value) ? ruleFailure(rule, "invalid_value", "not_equal", typeName(value)) : undefined;
  if (rule.op === "priceComparison" && priceMinor !== undefined) return checkBigIntComparison(rule, priceMinor);
  if (rule.op === "priceBetween" && priceMinor !== undefined) return priceMinor < rule.min || priceMinor > rule.max ? ruleFailure(rule, "out_of_range", `${rule.min}-${rule.max}`, priceMinor) : undefined;
  return undefined;
}
function checkNumberRule(rule: CompiledRule, value: number): RuleFailure | undefined {
  if (rule.op === "integer" && !Number.isInteger(value)) return ruleFailure(rule, "invalid_number", "integer", value);
  if (rule.op === "positive" && value <= 0) return ruleFailure(rule, "too_small", 0, value);
  if (rule.op === "negative" && value >= 0) return ruleFailure(rule, "too_big", 0, value);
  if (rule.op === "finite" && !Number.isFinite(value)) return ruleFailure(rule, "invalid_number", "finite", value);
  if (rule.op === "gt" && value <= Number(rule.value)) return ruleFailure(rule, "too_small", Number(rule.value), value);
  if (rule.op === "gte" && value < Number(rule.value)) return ruleFailure(rule, "too_small", Number(rule.value), value);
  if (rule.op === "lt" && value >= Number(rule.value)) return ruleFailure(rule, "too_big", Number(rule.value), value);
  if (rule.op === "lte" && value > Number(rule.value)) return ruleFailure(rule, "too_big", Number(rule.value), value);
  if (rule.op === "between" && (value < Number(rule.min) || value > Number(rule.max))) return ruleFailure(rule, "out_of_range", `${String(rule.min)}-${String(rule.max)}`, value);
  if (rule.op === "in" || rule.op === "notIn" || rule.op === "equal" || rule.op === "notEqual") return checkRule(rule, value, undefined);
  return undefined;
}
function checkDateRule(rule: CompiledRule, value: Date): RuleFailure | undefined { if (rule.op === "after" && value.getTime() <= rule.value.getTime()) return ruleFailure(rule, "too_small", rule.value.toISOString(), value.toISOString()); if (rule.op === "before" && value.getTime() >= rule.value.getTime()) return ruleFailure(rule, "too_big", rule.value.toISOString(), value.toISOString()); return undefined; }
function checkFileRule(rule: CompiledRule, value: File): RuleFailure | undefined {
  if (rule.op === "maxSize" && value.size > rule.value) return ruleFailure(rule, "too_big", rule.value, value.size);
  if (rule.op === "mime") {
    const type = value.type;
    const baseType = type.split(";", 1)[0]!.trim();
    if (!contains(rule.values, type) && !contains(rule.values, baseType)) return ruleFailure(rule, "invalid_value", rule.values.join(","), type);
  }
  return undefined;
}
function checkBigIntComparison(rule: Extract<CompiledRule, { readonly op: "priceComparison" }>, value: bigint): RuleFailure | undefined { if (rule.comparison === "gt" && value <= rule.value) return ruleFailure(rule, "too_small", rule.value, value); if (rule.comparison === "gte" && value < rule.value) return ruleFailure(rule, "too_small", rule.value, value); if (rule.comparison === "lt" && value >= rule.value) return ruleFailure(rule, "too_big", rule.value, value); if (rule.comparison === "lte" && value > rule.value) return ruleFailure(rule, "too_big", rule.value, value); return undefined; }
function executeRejectIf(plan: CompiledPlan, state: ExecutionState): boolean | Promise<boolean> {
  const jobs = state.reject;
  if (jobs === undefined || jobs.length === 0) return false;
  const tasks: RejectTask[] = [];
  let hasIssue = false;
  const total = jobs.length;
  for (let index = 0; index < total; index += 1) {
    const job = jobs[index]!;
    const rules = job.field.rejectIf;
    const ruleTotal = rules.length;
    for (let ruleIndex = 0; ruleIndex < ruleTotal; ruleIndex += 1) {
      const rule = rules[ruleIndex]!;
      tasks.push(Object.freeze({ job, rule }));
    }
  }
  const taskTotal = tasks.length;
  for (let index = 0; index < taskTotal; index += 1) {
    const task = tasks[index]!;
    const { job, rule } = task;
    const result = rule.predicate(job.value);
    if (isThenable(result)) return runRejectTasks(plan.concurrency, tasks, state, index, result, hasIssue);
    if (result) { hasIssue = true; addIssue(state, job.source, job.path, fieldName(job.source, job.path), "custom", rule.message ?? job.field.spec.message ?? "validators.invalid", undefined, undefined); }
  }
  return hasIssue;
}
interface RejectTask { readonly job: RejectJob; readonly rule: Readonly<{ readonly predicate: (value: unknown) => boolean | Promise<boolean>; readonly message?: string }> }
async function runRejectTasks(
  concurrency: number,
  tasks: readonly RejectTask[],
  state: ExecutionState,
  firstAsyncIndex: number,
  firstAsync: Promise<boolean> | PromiseLike<boolean>,
  previousHasIssue: boolean,
): Promise<boolean> {
  let cursor = firstAsyncIndex + 1;
  let hasIssue = previousHasIssue;
  const total = tasks.length;
  const results = new Array<boolean | undefined>(total);
  const worker = async (): Promise<void> => {
    while (cursor < total) {
      const index = cursor;
      cursor += 1;
      const task = tasks[index]!;
      results[index] = await task.rule.predicate(task.job.value);
    }
  };
  const waitFirst = async (): Promise<void> => { results[firstAsyncIndex] = await firstAsync; };
  const workerCount = Math.min(Math.max(concurrency - 1, 0), total - cursor);
  const workers = new Array<Promise<void>>(workerCount + 1);
  workers[0] = waitFirst();
  for (let index = 0; index < workerCount; index += 1) workers[index + 1] = worker();
  await Promise.all(workers);
  while (cursor < total) {
    const index = cursor;
    cursor += 1;
    const task = tasks[index]!;
    results[index] = await task.rule.predicate(task.job.value);
  }
  for (let index = firstAsyncIndex; index < total; index += 1) {
    if (results[index] === true) {
      hasIssue = true;
      const item = tasks[index]!;
      addIssue(state, item.job.source, item.job.path, fieldName(item.job.source, item.job.path), "custom", item.rule.message ?? item.job.field.spec.message ?? "validators.invalid", undefined, undefined);
    }
  }
  return hasIssue;
}
function executeStagesAndMappings(plan: CompiledPlan, state: ExecutionState): MaybePromise<ValidationResult> {
  const after = executeAfter(plan, state);
  if (isThenable(after)) return after.then(() => state.grouped !== undefined ? invalid(state.grouped) : finalizeOutput(plan, state));
  return state.grouped !== undefined ? invalid(state.grouped) : finalizeOutput(plan, state);
}
function executeAfter(plan: CompiledPlan, state: ExecutionState): void | Promise<void> {
  const callbacks = plan.stages?.after;
  if (callbacks === undefined || callbacks.length === 0) return undefined;
  const stageInput = buildStageInput(state);
  const reject = (path: string, message: string, nestedPath?: readonly PropertyKey[]): void => { const parsed = parseRejectPath(path); const fullPath = nestedPath === undefined ? Object.freeze([parsed.field]) : Object.freeze([parsed.field, ...nestedPath]); addIssue(state, parsed.source, fullPath, pathString(fullPath), "custom", message, undefined, undefined); };
  let chain: Promise<void> | undefined;
  const total = callbacks.length;
  for (let index = 0; index < total; index += 1) {
    const callback = callbacks[index]!;
    if (chain === undefined) { const result = callback(stageInput as never, reject); if (isThenable(result)) chain = result.then(() => undefined); }
    else chain = chain.then(() => callback(stageInput as never, reject));
  }
  return chain;
}
function finalizeOutput(plan: CompiledPlan, state: ExecutionState): ValidationResult {
  applyFieldMappings(plan, state);
  let body = state.sections.value;
  if (plan.legacyMapValue !== undefined) { const mapped = plan.legacyMapValue(asRecord(body)); if (isThenable(mapped)) throw new ValidatorError(ValidatorErrorCode.ASYNC_SCHEMA_MISMATCH, "mapV must remain synchronous."); body = mapped; }
  if (plan.legacyKeyMap !== undefined) { validateKeyMap(plan.legacyKeyMap, new Set(Object.keys(asRecord(body)))); body = applyKeyMap(body, plan.legacyKeyMap); }
  state.sections.value = body;
  applyPatches(plan, state);
  const mapped = plan.stages?.map;
  if (mapped !== undefined) { const value = mapped(buildStageInput(state) as never); if (isThenable(value)) throw new ValidatorError(ValidatorErrorCode.ASYNC_SCHEMA_MISMATCH, "map callback must remain synchronous."); return Object.freeze({ valid: true, value }); }
  const result: Record<string, unknown> = { valid: true, value: state.sections.value };
  for (const key of ["query", "path", "headers", "cookies", "message", "metadata"] as const) if (key in state.sections) result[key] = state.sections[key];
  return Object.freeze(result) as ValidationResult;
}
function applyFieldMappings(plan: CompiledPlan, state: ExecutionState): void {
  if (plan.rootBody !== undefined && "value" in state.sections) state.sections.value = applyCompiledFieldMappings(plan.rootBody.field, state.sections.value);
  const sources = plan.sources;
  const total = sources.length;
  for (let index = 0; index < total; index += 1) {
    const source = sources[index]!;
    if (!(source.inputKey in state.sections)) continue;
    const input = asRecord(state.sections[source.inputKey]);
    const output: Record<string, unknown> = Object.create(null);
    const fields = source.fields;
    const fieldTotal = fields.length;
    for (let fieldIndex = 0; fieldIndex < fieldTotal; fieldIndex += 1) { const field = fields[fieldIndex]!; if (hasOwn(input, field.key)) output[field.outputKey] = applyCompiledFieldMappings(field, input[field.key]); }
    state.sections[source.inputKey] = Object.freeze(output);
  }
}
function applyCompiledFieldMappings(field: CompiledField, value: unknown): unknown {
  let output = value;
  if (output !== null && field.nested !== undefined) {
    const input = asRecord(output);
    const mapped: Record<string, unknown> = Object.create(null);
    const fields = field.nested.fields;
    const total = fields.length;
    for (let index = 0; index < total; index += 1) { const nested = fields[index]!; if (hasOwn(input, nested.key)) mapped[nested.outputKey] = applyCompiledFieldMappings(nested, input[nested.key]); }
    output = Object.freeze(mapped);
  } else if (output !== null && field.item !== undefined) {
    if (!Array.isArray(output)) throw new ValidatorError(ValidatorErrorCode.INVALID_DEFINITION, "Array mapping received a non-array value.");
    const total = output.length;
    const mapped = new Array<unknown>(total);
    for (let index = 0; index < total; index += 1) mapped[index] = applyCompiledFieldMappings(field.item!, output[index]);
    output = Object.freeze(mapped);
  }
  const maps = field.maps;
  const total = maps.length;
  for (let index = 0; index < total; index += 1) { const mapped = maps[index]!(output); if (isThenable(mapped)) throw new ValidatorError(ValidatorErrorCode.ASYNC_SCHEMA_MISMATCH, "mapV must remain synchronous."); output = mapped; }
  return output;
}
function applyPatches(plan: CompiledPlan, state: ExecutionState): void {
  const patches = plan.stages?.patch;
  if (patches === undefined || patches.length === 0) return;
  const total = patches.length;
  for (let index = 0; index < total; index += 1) {
    const patch = patches[index]!(buildStageInput(state) as never);
    if (isThenable(patch)) throw new ValidatorError(ValidatorErrorCode.ASYNC_SCHEMA_MISMATCH, "patch callback must remain synchronous.");
    mergePatchSource(state, "value", patch.body); mergePatchSource(state, "query", patch.query); mergePatchSource(state, "path", patch.params ?? patch.path); mergePatchSource(state, "headers", patch.headers); mergePatchSource(state, "cookies", patch.cookies); mergePatchSource(state, "message", patch.message); mergePatchSource(state, "metadata", patch.metadata);
  }
}
function mergePatchSource(state: ExecutionState, key: string, patch: unknown): void {
  if (patch === undefined) return;
  if (!isRecord(patch)) throw new ValidatorError(ValidatorErrorCode.INVALID_STAGE, "patch source values must be objects.");
  const base = asRecord(state.sections[key]);
  const output: Record<string, unknown> = Object.create(null);
  for (const sourceKey in base) output[sourceKey] = base[sourceKey];
  for (const patchKey in patch) output[patchKey] = patch[patchKey];
  state.sections[key] = Object.freeze(output);
}
function buildStageInput(state: ExecutionState): Readonly<Record<string, unknown>> { return Object.freeze({ body: state.sections.value, query: state.sections.query, params: state.sections.path, path: state.sections.path, headers: state.sections.headers, cookies: state.sections.cookies, message: state.sections.message, metadata: state.sections.metadata }); }
function evaluatePresence(plan: SourcePlan, raw: Readonly<Record<string, unknown>>, output: Readonly<Record<string, unknown>>, state: ExecutionState): void {
  const fields = plan.fields;
  const total = fields.length;
  for (let index = 0; index < total; index += 1) {
    const field = fields[index]!;
    if (hasOwn(raw, field.key)) continue;
    const presence = field.presence;
    const presenceTotal = presence.length;
    for (let ruleIndex = 0; ruleIndex < presenceTotal; ruleIndex += 1) { const rule = presence[ruleIndex]!; if (presenceRequires(rule, raw, output)) { addIssue(state, plan.source, Object.freeze([field.key]), field.key, "required", rule.message ?? field.spec.message ?? "validators.required", undefined, undefined); break; } }
  }
}
function presenceRequires(rule: PresenceOp, raw: Readonly<Record<string, unknown>>, output: Readonly<Record<string, unknown>>): boolean {
  if (rule.op === "requiredWhen") return Object.is(hasOwn(output, rule.field) ? output[rule.field] : raw[rule.field], rule.value);
  const fields = rule.fields;
  const total = fields.length;
  if (rule.op === "requiredWith") { for (let index = 0; index < total; index += 1) if (hasOwn(raw, fields[index]!)) return true; return false; }
  if (rule.op === "requiredWithAll") { for (let index = 0; index < total; index += 1) if (!hasOwn(raw, fields[index]!)) return false; return true; }
  if (rule.op === "requiredWithout") { for (let index = 0; index < total; index += 1) if (!hasOwn(raw, fields[index]!)) return true; return false; }
  for (let index = 0; index < total; index += 1) if (hasOwn(raw, fields[index]!)) return false;
  return true;
}
function collectRejectJob(state: ExecutionState, source: ValidationSource, field: CompiledField, value: unknown, path: readonly PropertyKey[]): void {
  if (value === null || field.rejectIf.length === 0) return;
  const jobs = state.reject === undefined ? [] : [...state.reject];
  jobs.push(Object.freeze({ source, field, value, path }));
  state.reject = Object.freeze(jobs);
}
function addIssue(state: ExecutionState, source: ValidationSource, path: readonly PropertyKey[], field: string, code: string, message: string, allowed: IssueValue | undefined, entered: IssueValue | undefined): void {
  const grouped = state.grouped ?? (state.grouped = Object.create(null));
  const group = `${source}.${field}`;
  const issue = Object.freeze({ source, path, field, code, message: validationMessage(message, issueParameters(allowed, entered)) }) satisfies ValidationIssue;
  const current = grouped[group];
  if (current === undefined) grouped[group] = [issue]; else current.push(issue);
}
function invalid(grouped: Record<string, ValidationIssue[]>): ValidationResult { const output: Record<string, readonly ValidationIssue[]> = Object.create(null); for (const key in grouped) output[key] = Object.freeze(grouped[key]!); return Object.freeze({ valid: false, errors: Object.freeze(output) as ValidationErrors }); }
function normalizeHeaderRecord(value: unknown, selected: readonly string[]): unknown {
  if (!isRecord(value)) return value;
  const normalized: Record<string, unknown> = Object.create(null);
  for (const key in value) normalized[key.toLowerCase()] = value[key];
  const result: Record<string, unknown> = Object.create(null);
  const total = selected.length;
  for (let index = 0; index < total; index += 1) { const key = selected[index]!; const item = normalized[key]; if (item !== undefined) result[key] = item; }
  return Object.freeze(result);
}
function parseDecimal(input: string, options: CompiledPriceOptions): Readonly<{ readonly ok: true; readonly minor: bigint; readonly normalized: string }> | Readonly<{ readonly ok: false }> {
  const escaped = options.decimalSeparator === "." ? "\\." : ",";
  const fractionPattern = options.decimals === 0 ? "" : `(?:${escaped}(\\d{1,${options.decimals}}))?`;
  const match = new RegExp(`^(-?)(\\d+)${fractionPattern}$`, "u").exec(input.trim());
  if (match === null) return Object.freeze({ ok: false });
  const negative = match[1] === "-";
  if (negative && !options.allowNegative) return Object.freeze({ ok: false });
  const integer = match[2]!;
  const fraction = match[3] ?? "";
  const padded = `${fraction}${"0".repeat(options.decimals - fraction.length)}`;
  const scale = 10n ** BigInt(options.decimals);
  const minor = BigInt(integer) * scale + (padded.length === 0 ? 0n : BigInt(padded));
  const normalizedFraction = options.decimals === 0 ? "" : `.${padded}`;
  return Object.freeze({ ok: true, minor: negative ? -minor : minor, normalized: `${negative ? "-" : ""}${integer}${normalizedFraction}` });
}
function parsePriceConfig(value: unknown, options: CompiledPriceOptions): bigint { if (typeof value !== "string" && typeof value !== "number") throw new ValidatorError(ValidatorErrorCode.INVALID_PRICE_CONFIG, "Price comparison value must be a string or safe number."); if (typeof value === "number" && (!Number.isFinite(value) || !Number.isSafeInteger(value * 10 ** options.decimals))) throw new ValidatorError(ValidatorErrorCode.INVALID_PRICE_CONFIG, "Price comparison number is not safely representable."); const parsed = parseDecimal(String(value), options); if (!parsed.ok) throw new ValidatorError(ValidatorErrorCode.INVALID_PRICE_CONFIG, "Price comparison value is invalid."); return parsed.minor; }
function parseRejectPath(path: string): Readonly<{ readonly source: ValidationSource; readonly field: string }> { const dot = path.indexOf("."); const sourceText = dot === -1 ? path : path.slice(0, dot); const field = dot === -1 ? path : path.slice(dot + 1); const source = sourceText === "params" ? "path" : sourceText as ValidationSource; if (!isValidationSource(source) || field.length === 0) throw new ValidatorError(ValidatorErrorCode.INVALID_STAGE, "after rejection path is invalid."); return Object.freeze({ source, field }); }
function isValidationSource(value: string): value is ValidationSource { return value === "body" || value === "query" || value === "path" || value === "headers" || value === "cookies" || value === "message" || value === "metadata"; }
function appendPath(path: readonly PropertyKey[], value: PropertyKey): readonly PropertyKey[] { const total = path.length; const next = new Array<PropertyKey>(total + 1); for (let index = 0; index < total; index += 1) next[index] = path[index]!; next[total] = value; return Object.freeze(next); }
function fieldName(source: ValidationSource, path: readonly PropertyKey[]): string { return path.length === 0 ? source : pathString(path); }
function pathString(path: readonly PropertyKey[]): string { let output = ""; const total = path.length; for (let index = 0; index < total; index += 1) output += `${index === 0 ? "" : "."}${String(path[index])}`; return output; }
function fail(field: CompiledField, code: string, allowed: IssueValue, entered: IssueValue): ParseResult { return Object.freeze({ ok: false, code, message: field.spec.message ?? "validators.invalid", allowed, entered }); }
function ruleFailure(rule: Readonly<{ readonly message?: string }>, code: string, allowed: IssueValue, entered: IssueValue): RuleFailure { return Object.freeze({ code, message: rule.message ?? "validators.invalid", allowed, entered }); }
function isEffectivelyOptional(field: CompiledField): boolean { return field.spec.optional || field.presence.length > 0; }
function contains(values: readonly unknown[], value: unknown): boolean { const total = values.length; for (let index = 0; index < total; index += 1) if (Object.is(values[index], value)) return true; return false; }
function asRecord(value: unknown): Readonly<Record<string, unknown>> { if (!isRecord(value)) throw new ValidatorError(ValidatorErrorCode.INVALID_KEY_MAPPING, "Value mapping requires an object body."); return value; }
function hasOwn(value: Readonly<Record<string, unknown>>, key: string): boolean { return Object.prototype.hasOwnProperty.call(value, key); }
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function safeKey(value: string): boolean { return value.length > 0 && value !== "__proto__" && value !== "prototype" && value !== "constructor"; }
function isThenable<T>(value: T | Promise<T> | PromiseLike<T>): value is Promise<T> | PromiseLike<T> { return typeof value === "object" && value !== null && "then" in value && typeof value.then === "function"; }
function typeName(value: unknown): string { if (value === null) return "null"; if (Array.isArray(value)) return "array"; return typeof value; }
function escapeRegex(value: string): string { return value.replace(/[\\^$.*+?()[\]{}|]/gu, "\\$&"); }
