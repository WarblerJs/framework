import { ValidatorError, ValidatorErrorCode } from "./errors";
const UNSAFE = new Set(["__proto__", "prototype", "constructor"]);
const KEY = /^[A-Za-z_$][A-Za-z0-9_$]{0,127}$/u;

export function validateKeyMap(map: Readonly<Record<string, string>>, knownKeys?: ReadonlySet<string>): Readonly<Record<string, string>> {
  const result: Record<string, string> = Object.create(null);
  const targets = new Set<string>();
  for (const [source, target] of Object.entries(map)) {
    if (!KEY.test(source) || !KEY.test(target)) throw new ValidatorError(ValidatorErrorCode.INVALID_KEY_MAPPING, "Mapped keys must be non-empty property names.");
    if (UNSAFE.has(source) || UNSAFE.has(target)) throw new ValidatorError(ValidatorErrorCode.UNSAFE_MAPPED_KEY, "Unsafe mapped key.");
    if (knownKeys !== undefined && !knownKeys.has(source)) throw new ValidatorError(ValidatorErrorCode.INVALID_KEY_MAPPING, `Mapped source key "${source}" does not exist.`);
    if (targets.has(target)) throw new ValidatorError(ValidatorErrorCode.DUPLICATE_MAPPED_KEY, `Duplicate mapped target "${target}".`);
    if (knownKeys?.has(target) && source !== target && map[target] === undefined) throw new ValidatorError(ValidatorErrorCode.DUPLICATE_MAPPED_KEY, `Mapped target "${target}" already exists.`);
    targets.add(target); result[source] = target;
  }
  return Object.freeze(result);
}
export function applyKeyMap(value: unknown, map: Readonly<Record<string, string>>): unknown {
  if (!isRecord(value)) throw new ValidatorError(ValidatorErrorCode.INVALID_KEY_MAPPING, "Key mapping requires an object value.");
  const result: Record<string, unknown> = Object.create(null);
  for (const [key, item] of Object.entries(value)) result[map[key] ?? key] = item;
  return Object.freeze(result);
}
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> { return typeof value === "object" && value !== null && !Array.isArray(value); }
