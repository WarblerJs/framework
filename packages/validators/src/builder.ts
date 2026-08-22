import { ValidatorError, ValidatorErrorCode } from "./errors";

export type ValidatorKind = "string" | "number" | "boolean" | "date" | "email" | "price" | "file" | "object" | "array" | "uuid" | "ulid" | "cuid" | "nanoid" | "serial";
export type RuleOp =
  | Readonly<{ readonly op: "min" | "max" | "length"; readonly value: number; readonly message?: string }>
  | Readonly<{ readonly op: "regex"; readonly value: RegExp; readonly message?: string }>
  | Readonly<{ readonly op: "digits"; readonly min?: number; readonly max?: number; readonly message?: string }>
  | Readonly<{ readonly op: "integer" | "positive" | "negative" | "finite"; readonly message?: string }>
  | Readonly<{ readonly op: "gt" | "gte" | "lt" | "lte"; readonly value: unknown; readonly message?: string }>
  | Readonly<{ readonly op: "between"; readonly min: unknown; readonly max: unknown; readonly message?: string }>
  | Readonly<{ readonly op: "in" | "notIn"; readonly values: readonly unknown[]; readonly message?: string }>
  | Readonly<{ readonly op: "equal" | "notEqual"; readonly value: unknown; readonly message?: string }>
  | Readonly<{ readonly op: "trim"; readonly message?: string }>
  | Readonly<{ readonly op: "mime"; readonly values: readonly string[]; readonly message?: string }>
  | Readonly<{ readonly op: "maxSize"; readonly value: number; readonly message?: string }>
  | Readonly<{ readonly op: "after" | "before"; readonly value: Date; readonly message?: string }>;
export type PresenceOp =
  | Readonly<{ readonly op: "requiredWhen"; readonly field: string; readonly value: unknown; readonly message?: string }>
  | Readonly<{ readonly op: "requiredWith" | "requiredWithAll" | "requiredWithout" | "requiredWithoutAll"; readonly fields: readonly string[]; readonly message?: string }>;
export type RejectIfPredicate<TValue> = (value: TValue) => boolean | Promise<boolean>;
export type ValueMapper<TValue, TResult> = (value: TValue) => TResult;

export interface PriceOptions {
  readonly min?: string | number;
  readonly max?: string | number;
  readonly decimals?: number;
  readonly scale?: number;
  readonly allowString?: boolean;
  readonly allowNegative?: boolean;
  readonly decimalSeparator?: "." | ",";
  readonly normalize?: "string" | "minor-unit";
}
export interface SerialOptions { readonly prefix?: string; readonly separator?: string; readonly digits: number }
export interface FieldSpec<TValue = unknown> {
  readonly kind: ValidatorKind;
  readonly message?: string;
  readonly optional: boolean;
  readonly nullable: boolean;
  readonly rules: readonly RuleOp[];
  readonly presence: readonly PresenceOp[];
  readonly rejectIf: readonly Readonly<{ readonly predicate: RejectIfPredicate<TValue>; readonly message?: string }>[];
  readonly maps: readonly ValueMapper<unknown, unknown>[];
  readonly keyMap?: string;
  readonly shape?: RuleShape;
  readonly item?: AnyField;
  readonly price?: PriceOptions;
  readonly serial?: SerialOptions;
}
export interface WarblerField<TValue, TOptional extends boolean = false, TNullable extends boolean = false, TKey extends string = never> {
  readonly __warblerField: true;
  readonly __warblerOutput: TValue;
  readonly __warblerOptional: TOptional;
  readonly __warblerNullable: TNullable;
  readonly __warblerKey: TKey;
  readonly __warblerSpec: FieldSpec<TValue>;
}
export type AnyField = WarblerField<any, boolean, boolean, string>;
export type RuleShape = Readonly<Record<string, AnyField>>;
export type FieldOutput<T> = T extends WarblerField<infer TValue, infer _Optional, infer TNullable, infer _Key> ? TNullable extends true ? TValue | null : TValue : unknown;
export type FieldOptional<T> = T extends WarblerField<infer _TValue, infer TOptional, infer _Nullable, infer _Key> ? TOptional : false;
export type FieldKey<T, TFallback extends string> = T extends WarblerField<infer _TValue, infer _Optional, infer _Nullable, infer TKey> ? [TKey] extends [never] ? TFallback : TKey : TFallback;
type OptionalKeys<T extends RuleShape> = { [K in keyof T]-?: FieldOptional<T[K]> extends true ? K : never }[keyof T];
type RequiredKeys<T extends RuleShape> = Exclude<keyof T, OptionalKeys<T>>;
export type InferRuleShape<T> = T extends RuleShape
  ? Readonly<{ [K in RequiredKeys<T> as K extends string ? FieldKey<T[K], K> : never]-?: FieldOutput<T[K]> } & { [K in OptionalKeys<T> as K extends string ? FieldKey<T[K], K> : never]?: FieldOutput<T[K]> }>
  : unknown;

export interface BaseValidator<TValue, TOptional extends boolean, TNullable extends boolean, TKey extends string> extends WarblerField<TValue, TOptional, TNullable, TKey> {
  /** Allows the key to be absent. */
  optional(): BaseValidator<TValue, true, TNullable, TKey>;
  /** Allows a present value to be null. */
  nullable(): BaseValidator<TValue, TOptional, true, TKey>;
  /** Rejects a parsed field value when the predicate returns true. */
  rejectIf(predicate: RejectIfPredicate<TValue>, message?: string): BaseValidator<TValue, TOptional, TNullable, TKey>;
  /** Maps one parsed field value. */
  mapV<TResult>(mapper: ValueMapper<TValue, TResult>): BaseValidator<TResult, TOptional, TNullable, TKey>;
  /** Renames this field in its source output. */
  mapK<const TNewKey extends string>(key: TNewKey | (() => TNewKey)): BaseValidator<TValue, TOptional, TNullable, TNewKey>;
  /** Requires this field when another parsed field equals a value. */
  requiredWhen(field: string, value: unknown, message?: string): BaseValidator<TValue, true, TNullable, TKey>;
  /** Requires this field when any referenced field exists. */
  requiredWith(fields: string | readonly string[], message?: string): BaseValidator<TValue, true, TNullable, TKey>;
  /** Requires this field when all referenced fields exist. */
  requiredWithAll(fields: string | readonly string[], message?: string): BaseValidator<TValue, true, TNullable, TKey>;
  /** Requires this field when any referenced field is absent. */
  requiredWithout(fields: string | readonly string[], message?: string): BaseValidator<TValue, true, TNullable, TKey>;
  /** Requires this field when all referenced fields are absent. */
  requiredWithoutAll(fields: string | readonly string[], message?: string): BaseValidator<TValue, true, TNullable, TKey>;
  /** Allows only the supplied parsed values. */
  in<const TValues extends readonly TValue[]>(values: TValues, message?: string): BaseValidator<TValues[number], TOptional, TNullable, TKey>;
  /** Rejects the supplied parsed values. */
  notIn(values: readonly TValue[], message?: string): BaseValidator<TValue, TOptional, TNullable, TKey>;
  /** Requires strict equality to the supplied parsed value. */
  equal(value: TValue, message?: string): BaseValidator<TValue, TOptional, TNullable, TKey>;
  /** Rejects strict equality to the supplied parsed value. */
  notEqual(value: TValue, message?: string): BaseValidator<TValue, TOptional, TNullable, TKey>;
}
export interface StringValidator<TOptional extends boolean = false, TNullable extends boolean = false, TKey extends string = never> extends BaseValidator<string, TOptional, TNullable, TKey> {
  min(value: number, message?: string): StringValidator<TOptional, TNullable, TKey>;
  max(value: number, message?: string): StringValidator<TOptional, TNullable, TKey>;
  length(value: number, message?: string): StringValidator<TOptional, TNullable, TKey>;
  regex(value: RegExp, message?: string): StringValidator<TOptional, TNullable, TKey>;
  digits(options?: Readonly<{ readonly min?: number; readonly max?: number }> | string, message?: string): StringValidator<TOptional, TNullable, TKey>;
  trim(): StringValidator<TOptional, TNullable, TKey>;
}
export interface NumberValidator<TOptional extends boolean = false, TNullable extends boolean = false, TKey extends string = never> extends BaseValidator<number, TOptional, TNullable, TKey> {
  integer(message?: string): NumberValidator<TOptional, TNullable, TKey>;
  int(message?: string): NumberValidator<TOptional, TNullable, TKey>;
  positive(message?: string): NumberValidator<TOptional, TNullable, TKey>;
  negative(message?: string): NumberValidator<TOptional, TNullable, TKey>;
  finite(message?: string): NumberValidator<TOptional, TNullable, TKey>;
  gt(value: number, message?: string): NumberValidator<TOptional, TNullable, TKey>;
  greaterThan(value: number, message?: string): NumberValidator<TOptional, TNullable, TKey>;
  gte(value: number, message?: string): NumberValidator<TOptional, TNullable, TKey>;
  greaterThanOrEqual(value: number, message?: string): NumberValidator<TOptional, TNullable, TKey>;
  lt(value: number, message?: string): NumberValidator<TOptional, TNullable, TKey>;
  lessThan(value: number, message?: string): NumberValidator<TOptional, TNullable, TKey>;
  lte(value: number, message?: string): NumberValidator<TOptional, TNullable, TKey>;
  lessThanOrEqual(value: number, message?: string): NumberValidator<TOptional, TNullable, TKey>;
  between(min: number, max: number, message?: string): NumberValidator<TOptional, TNullable, TKey>;
}
export interface BooleanValidator<TOptional extends boolean = false, TNullable extends boolean = false, TKey extends string = never> extends BaseValidator<boolean, TOptional, TNullable, TKey> {}
export interface DateValidator<TOptional extends boolean = false, TNullable extends boolean = false, TKey extends string = never> extends BaseValidator<Date, TOptional, TNullable, TKey> {
  after(value: Date, message?: string): DateValidator<TOptional, TNullable, TKey>;
  before(value: Date, message?: string): DateValidator<TOptional, TNullable, TKey>;
}
export interface PriceValidator<TOptional extends boolean = false, TNullable extends boolean = false, TKey extends string = never> extends BaseValidator<string, TOptional, TNullable, TKey> {
  gt(value: string | number, message?: string): PriceValidator<TOptional, TNullable, TKey>;
  gte(value: string | number, message?: string): PriceValidator<TOptional, TNullable, TKey>;
  lt(value: string | number, message?: string): PriceValidator<TOptional, TNullable, TKey>;
  lte(value: string | number, message?: string): PriceValidator<TOptional, TNullable, TKey>;
  between(min: string | number, max: string | number, message?: string): PriceValidator<TOptional, TNullable, TKey>;
}
export interface FileValidator<TOptional extends boolean = false, TNullable extends boolean = false, TKey extends string = never> extends BaseValidator<File, TOptional, TNullable, TKey> {
  maxSize(value: number | string, message?: string): FileValidator<TOptional, TNullable, TKey>;
  max(value: number | string, message?: string): FileValidator<TOptional, TNullable, TKey>;
  mime(values: readonly string[], message?: string): FileValidator<TOptional, TNullable, TKey>;
}
export interface ObjectValidator<TShape extends RuleShape, TOptional extends boolean = false, TNullable extends boolean = false, TKey extends string = never> extends BaseValidator<InferRuleShape<TShape>, TOptional, TNullable, TKey> {}
export interface ArrayValidator<TItem extends AnyField, TOptional extends boolean = false, TNullable extends boolean = false, TKey extends string = never> extends BaseValidator<readonly FieldOutput<TItem>[], TOptional, TNullable, TKey> {
  min(value: number, message?: string): ArrayValidator<TItem, TOptional, TNullable, TKey>;
  max(value: number, message?: string): ArrayValidator<TItem, TOptional, TNullable, TKey>;
  length(value: number, message?: string): ArrayValidator<TItem, TOptional, TNullable, TKey>;
}
type AnyBase = BaseValidator<any, boolean, boolean, string>;

function cloneSpec<TValue>(current: FieldSpec<TValue>, patch: Partial<FieldSpec<TValue>>): FieldSpec<TValue> {
  return Object.freeze({
    kind: patch.kind ?? current.kind,
    message: patch.message ?? current.message,
    optional: patch.optional ?? current.optional,
    nullable: patch.nullable ?? current.nullable,
    rules: patch.rules ?? current.rules,
    presence: patch.presence ?? current.presence,
    rejectIf: patch.rejectIf ?? current.rejectIf,
    maps: patch.maps ?? current.maps,
    ...(patch.keyMap !== undefined || current.keyMap !== undefined ? { keyMap: patch.keyMap ?? current.keyMap } : {}),
    ...(patch.shape !== undefined || current.shape !== undefined ? { shape: patch.shape ?? current.shape } : {}),
    ...(patch.item !== undefined || current.item !== undefined ? { item: patch.item ?? current.item } : {}),
    ...(patch.price !== undefined || current.price !== undefined ? { price: patch.price ?? current.price } : {}),
    ...(patch.serial !== undefined || current.serial !== undefined ? { serial: patch.serial ?? current.serial } : {}),
  });
}
function appendRule<TValue>(current: FieldSpec<TValue>, rule: RuleOp): FieldSpec<TValue> { return cloneSpec(current, { rules: Object.freeze([...current.rules, Object.freeze(rule)]) }); }
function appendPresence<TValue>(current: FieldSpec<TValue>, presence: PresenceOp): FieldSpec<TValue> { return cloneSpec(current, { presence: Object.freeze([...current.presence, Object.freeze(presence)]), optional: true }); }
function spec(kind: ValidatorKind, message?: string): FieldSpec<unknown> {
  return Object.freeze({ kind, ...(message === undefined ? {} : { message }), optional: false, nullable: false, rules: Object.freeze([]), presence: Object.freeze([]), rejectIf: Object.freeze([]), maps: Object.freeze([]) });
}
function fieldList(fields: string | readonly string[]): readonly string[] { return Object.freeze(typeof fields === "string" ? [fields] : [...fields]); }
function base<TValue, TOptional extends boolean, TNullable extends boolean, TKey extends string>(current: FieldSpec<TValue>, create: (next: FieldSpec<any>) => AnyBase): BaseValidator<TValue, TOptional, TNullable, TKey> {
  return Object.freeze({
    __warblerField: true as const,
    __warblerSpec: current,
    optional: () => create(cloneSpec(current, { optional: true })),
    nullable: () => create(cloneSpec(current, { nullable: true })),
    rejectIf: (predicate: RejectIfPredicate<TValue>, message?: string) => {
      if (typeof predicate !== "function") throw new ValidatorError(ValidatorErrorCode.INVALID_DEFINITION, "rejectIf predicate must be a function.");
      return create(cloneSpec(current, { rejectIf: Object.freeze([...current.rejectIf, Object.freeze({ predicate, ...(message === undefined ? {} : { message }) })]) }));
    },
    mapV: <TResult>(mapper: ValueMapper<TValue, TResult>) => {
      if (typeof mapper !== "function") throw new ValidatorError(ValidatorErrorCode.INVALID_DEFINITION, "mapV mapper must be a function.");
      return create(cloneSpec(current, { maps: Object.freeze([...current.maps, mapper as ValueMapper<unknown, unknown>]) }));
    },
    mapK: (key: string | (() => string)) => create(cloneSpec(current, { keyMap: typeof key === "function" ? key() : key })),
    requiredWhen: (field: string, value: unknown, message?: string) => create(appendPresence(current, { op: "requiredWhen", field, value, ...(message === undefined ? {} : { message }) })),
    requiredWith: (fields: string | readonly string[], message?: string) => create(appendPresence(current, { op: "requiredWith", fields: fieldList(fields), ...(message === undefined ? {} : { message }) })),
    requiredWithAll: (fields: string | readonly string[], message?: string) => create(appendPresence(current, { op: "requiredWithAll", fields: fieldList(fields), ...(message === undefined ? {} : { message }) })),
    requiredWithout: (fields: string | readonly string[], message?: string) => create(appendPresence(current, { op: "requiredWithout", fields: fieldList(fields), ...(message === undefined ? {} : { message }) })),
    requiredWithoutAll: (fields: string | readonly string[], message?: string) => create(appendPresence(current, { op: "requiredWithoutAll", fields: fieldList(fields), ...(message === undefined ? {} : { message }) })),
    in: (values: readonly TValue[], message?: string) => create(appendRule(current, { op: "in", values: Object.freeze([...values]), ...(message === undefined ? {} : { message }) })),
    notIn: (values: readonly TValue[], message?: string) => create(appendRule(current, { op: "notIn", values: Object.freeze([...values]), ...(message === undefined ? {} : { message }) })),
    equal: (value: TValue, message?: string) => create(appendRule(current, { op: "equal", value, ...(message === undefined ? {} : { message }) })),
    notEqual: (value: TValue, message?: string) => create(appendRule(current, { op: "notEqual", value, ...(message === undefined ? {} : { message }) })),
  }) as BaseValidator<TValue, TOptional, TNullable, TKey>;
}
function createString(current: FieldSpec<unknown>): StringValidator<boolean, boolean, string> {
  const create = createString as (next: FieldSpec<any>) => AnyBase;
  return Object.freeze({
    ...base<string, boolean, boolean, string>(current as FieldSpec<string>, create),
    min: (value: number, message?: string) => createString(appendRule(current, { op: "min", value, ...(message === undefined ? {} : { message }) })),
    max: (value: number, message?: string) => createString(appendRule(current, { op: "max", value, ...(message === undefined ? {} : { message }) })),
    length: (value: number, message?: string) => createString(appendRule(current, { op: "length", value, ...(message === undefined ? {} : { message }) })),
    regex: (value: RegExp, message?: string) => createString(appendRule(current, { op: "regex", value, ...(message === undefined ? {} : { message }) })),
    digits: (options?: Readonly<{ readonly min?: number; readonly max?: number }> | string, message?: string) => {
      const values = typeof options === "object" && options !== null ? options : {};
      const ruleMessage = typeof options === "string" ? options : message;
      return createString(appendRule(current, { op: "digits", ...(values.min === undefined ? {} : { min: values.min }), ...(values.max === undefined ? {} : { max: values.max }), ...(ruleMessage === undefined ? {} : { message: ruleMessage }) }));
    },
    trim: () => createString(appendRule(current, { op: "trim" })),
  }) as StringValidator<boolean, boolean, string>;
}
function createNumber(current: FieldSpec<unknown>): NumberValidator<boolean, boolean, string> {
  const create = createNumber as (next: FieldSpec<any>) => AnyBase;
  const comparison = (op: "gt" | "gte" | "lt" | "lte", value: number, message?: string) => createNumber(appendRule(current, { op, value, ...(message === undefined ? {} : { message }) }));
  return Object.freeze({
    ...base<number, boolean, boolean, string>(current as FieldSpec<number>, create),
    integer: (message?: string) => createNumber(appendRule(current, { op: "integer", ...(message === undefined ? {} : { message }) })),
    int: (message?: string) => createNumber(appendRule(current, { op: "integer", ...(message === undefined ? {} : { message }) })),
    positive: (message?: string) => createNumber(appendRule(current, { op: "positive", ...(message === undefined ? {} : { message }) })),
    negative: (message?: string) => createNumber(appendRule(current, { op: "negative", ...(message === undefined ? {} : { message }) })),
    finite: (message?: string) => createNumber(appendRule(current, { op: "finite", ...(message === undefined ? {} : { message }) })),
    gt: (value: number, message?: string) => comparison("gt", value, message),
    greaterThan: (value: number, message?: string) => comparison("gt", value, message),
    gte: (value: number, message?: string) => comparison("gte", value, message),
    greaterThanOrEqual: (value: number, message?: string) => comparison("gte", value, message),
    lt: (value: number, message?: string) => comparison("lt", value, message),
    lessThan: (value: number, message?: string) => comparison("lt", value, message),
    lte: (value: number, message?: string) => comparison("lte", value, message),
    lessThanOrEqual: (value: number, message?: string) => comparison("lte", value, message),
    between: (min: number, max: number, message?: string) => createNumber(appendRule(current, { op: "between", min, max, ...(message === undefined ? {} : { message }) })),
  }) as NumberValidator<boolean, boolean, string>;
}
function createBoolean(current: FieldSpec<unknown>): BooleanValidator<boolean, boolean, string> { return base<boolean, boolean, boolean, string>(current as FieldSpec<boolean>, createBoolean as (next: FieldSpec<any>) => AnyBase) as BooleanValidator<boolean, boolean, string>; }
function createDateField(current: FieldSpec<unknown>): DateValidator<boolean, boolean, string> {
  const create = createDateField as (next: FieldSpec<any>) => AnyBase;
  return Object.freeze({ ...base<Date, boolean, boolean, string>(current as FieldSpec<Date>, create), after: (value: Date, message?: string) => createDateField(appendRule(current, { op: "after", value, ...(message === undefined ? {} : { message }) })), before: (value: Date, message?: string) => createDateField(appendRule(current, { op: "before", value, ...(message === undefined ? {} : { message }) })) }) as DateValidator<boolean, boolean, string>;
}
function createPrice(current: FieldSpec<unknown>): PriceValidator<boolean, boolean, string> {
  const create = createPrice as (next: FieldSpec<any>) => AnyBase;
  const comparison = (op: "gt" | "gte" | "lt" | "lte", value: string | number, message?: string) => createPrice(appendRule(current, { op, value, ...(message === undefined ? {} : { message }) }));
  return Object.freeze({ ...base<string, boolean, boolean, string>(current as FieldSpec<string>, create), gt: (value: string | number, message?: string) => comparison("gt", value, message), gte: (value: string | number, message?: string) => comparison("gte", value, message), lt: (value: string | number, message?: string) => comparison("lt", value, message), lte: (value: string | number, message?: string) => comparison("lte", value, message), between: (min: string | number, max: string | number, message?: string) => createPrice(appendRule(current, { op: "between", min, max, ...(message === undefined ? {} : { message }) })) }) as PriceValidator<boolean, boolean, string>;
}
function createFile(current: FieldSpec<unknown>): FileValidator<boolean, boolean, string> {
  const create = createFile as (next: FieldSpec<any>) => AnyBase;
  return Object.freeze({ ...base<File, boolean, boolean, string>(current as FieldSpec<File>, create), maxSize: (value: number | string, message?: string) => createFile(appendRule(current, { op: "maxSize", value: parseByteSize(value), ...(message === undefined ? {} : { message }) })), max: (value: number | string, message?: string) => createFile(appendRule(current, { op: "maxSize", value: parseByteSize(value), ...(message === undefined ? {} : { message }) })), mime: (values: readonly string[], message?: string) => createFile(appendRule(current, { op: "mime", values: Object.freeze([...values]), ...(message === undefined ? {} : { message }) })) }) as FileValidator<boolean, boolean, string>;
}
function createObject<TShape extends RuleShape>(current: FieldSpec<InferRuleShape<TShape>>): ObjectValidator<TShape, boolean, boolean, string> { return base<InferRuleShape<TShape>, boolean, boolean, string>(current, createObject as (next: FieldSpec<any>) => AnyBase) as ObjectValidator<TShape, boolean, boolean, string>; }
function createArray<TItem extends AnyField>(current: FieldSpec<readonly FieldOutput<TItem>[]>): ArrayValidator<TItem, boolean, boolean, string> {
  const create = createArray as (next: FieldSpec<any>) => AnyBase;
  return Object.freeze({ ...base<readonly FieldOutput<TItem>[], boolean, boolean, string>(current, create), min: (value: number, message?: string) => createArray<TItem>(appendRule(current, { op: "min", value, ...(message === undefined ? {} : { message }) }) as FieldSpec<readonly FieldOutput<TItem>[]>), max: (value: number, message?: string) => createArray<TItem>(appendRule(current, { op: "max", value, ...(message === undefined ? {} : { message }) }) as FieldSpec<readonly FieldOutput<TItem>[]>), length: (value: number, message?: string) => createArray<TItem>(appendRule(current, { op: "length", value, ...(message === undefined ? {} : { message }) }) as FieldSpec<readonly FieldOutput<TItem>[]>) }) as ArrayValidator<TItem, boolean, boolean, string>;
}
function parseByteSize(value: number | string): number {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value <= 0) throw new ValidatorError(ValidatorErrorCode.INVALID_DEFINITION, "File size limit must be a positive safe integer.");
    return value;
  }
  const match = /^(\d+)(b|kb|mb|gb)$/iu.exec(value.trim());
  if (match === null) throw new ValidatorError(ValidatorErrorCode.INVALID_DEFINITION, "File size limit is invalid.");
  const amount = Number(match[1]);
  const unit = match[2]!.toLowerCase();
  const multiplier = unit === "b" ? 1 : unit === "kb" ? 1024 : unit === "mb" ? 1024 * 1024 : 1024 * 1024 * 1024;
  const total = amount * multiplier;
  if (!Number.isSafeInteger(total) || total <= 0) throw new ValidatorError(ValidatorErrorCode.INVALID_DEFINITION, "File size limit is invalid.");
  return total;
}

export const v = Object.freeze({
  /** Creates a string validator. */ string: (message?: string): StringValidator => createString(spec("string", message)) as StringValidator,
  /** Creates a number validator. Numeric strings are parsed before callbacks. */ number: (message?: string): NumberValidator => createNumber(spec("number", message)) as NumberValidator,
  /** Creates a boolean validator. */ boolean: (message?: string): BooleanValidator => createBoolean(spec("boolean", message)) as BooleanValidator,
  /** Creates a date validator. */ date: (message?: string): DateValidator => createDateField(spec("date", message)) as DateValidator,
  /** Creates an email validator. */ email: (message?: string): StringValidator => createString(spec("email", message)) as StringValidator,
  /** Creates an exact decimal price validator. */ price: (message?: string, options: PriceOptions = Object.freeze({})): PriceValidator => createPrice(Object.freeze({ ...spec("price", message), price: Object.freeze({ ...options }) })) as PriceValidator,
  /** Creates a file validator. */ file: (message?: string): FileValidator => createFile(spec("file", message)) as FileValidator,
  /** Creates a strict object validator. */ object: <const TShape extends RuleShape>(shape: TShape, message?: string): ObjectValidator<TShape> => createObject<TShape>(Object.freeze({ ...spec("object", message), shape: Object.freeze({ ...shape }) }) as FieldSpec<InferRuleShape<TShape>>) as ObjectValidator<TShape>,
  /** Creates an array validator. */ array: <const TItem extends AnyField>(item: TItem, message?: string): ArrayValidator<TItem> => createArray<TItem>(Object.freeze({ ...spec("array", message), item }) as FieldSpec<readonly FieldOutput<TItem>[]>) as ArrayValidator<TItem>,
  /** Creates a UUID validator. */ uuid: (message?: string): StringValidator => createString(spec("uuid", message)) as StringValidator,
  /** Creates a ULID validator. */ ulid: (message?: string): StringValidator => createString(spec("ulid", message)) as StringValidator,
  /** Creates a CUID validator. */ cuid: (message?: string): StringValidator => createString(spec("cuid", message)) as StringValidator,
  /** Creates a Nano ID validator. */ nanoid: (message?: string): StringValidator => createString(spec("nanoid", message)) as StringValidator,
  /** Creates a configurable serial validator. */ serial: (message: string | undefined, options: SerialOptions): StringValidator => createString(Object.freeze({ ...spec("serial", message), serial: Object.freeze({ ...options }) })) as StringValidator,
});

export function isWarblerField(value: unknown): value is AnyField {
  return typeof value === "object" && value !== null && "__warblerField" in value && (value as { readonly __warblerField?: unknown }).__warblerField === true;
}
