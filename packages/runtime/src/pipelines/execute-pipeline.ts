import { InvalidApplicationBindingsError, InvalidGuardResultError } from "../errors/runtime-errors";
import { RuntimeDiagnosticCode } from "../diagnostics/runtime-diagnostic-codes";
import type {
  GuardBinding,
  HandlerBinding,
  MiddlewareBinding,
  RuntimeGuard,
  RuntimeMiddleware,
  ValidatorBinding,
} from "../generated/executable-bindings";

/** Executes generated Guards in order while retaining a synchronous fast path. */
export function executeGuardRange(bindings: readonly (GuardBinding | undefined)[], ids: readonly number[], input: unknown): boolean | Promise<boolean> {
  for (let index = 0; index < ids.length; index++) {
    const guardId = ids[index]!;
    const execute = bindings[guardId]?.execute;
    if (typeof execute !== "function") invalidBinding(`Guard binding ${guardId} is not executable.`);
    const result = (execute as RuntimeGuard)(input);
    if (isThenable(result)) return continueGuards(result, bindings, ids, input, index + 1);
    if (typeof result !== "boolean") throw new InvalidGuardResultError(`${RuntimeDiagnosticCode.GUARD_RESULT_INVALID}: Guard ${guardId} returned a non-boolean result.`);
    if (!result) return false;
  }
  return true;
}
/** Executes one generated Validator without schema reconstruction. */
export function executeValidator(
  binding: ValidatorBinding | undefined,
  input: unknown,
): Readonly<{ valid: boolean; value: unknown; errors?: unknown }> | Promise<Readonly<{ valid: boolean; value: unknown; errors?: unknown }>> {
  if (binding === undefined) return Object.freeze({ valid: true, value: input });
  if (typeof binding.validate !== "function") invalidBinding(`Validator binding ${binding.id} is not executable.`);
  const result = (binding.validate as (value: unknown) => unknown)(input);
  if (isThenable(result)) return result.then((value) => normalizeValidation(value, input));
  return normalizeValidation(result, input);
}
function normalizeValidation(result: unknown, input?: unknown): Readonly<{ valid: boolean; value: unknown; errors?: unknown }> {
  if (result === false) return Object.freeze({ valid: false, value: undefined });
  if (isInvalidResult(result)) return Object.freeze({ valid: false, value: undefined, ...("errors" in result ? { errors: result.errors } : {}) });
  if (result === true) return Object.freeze({ valid: true, value: input });
  if (hasValidatedValue(result)) return Object.freeze({ valid: true, value: result.value });
  return Object.freeze({ valid: true, value: result });
}
/** Executes one direct generated Handler binding. */
export function executeHandler(binding: HandlerBinding, controller: unknown, input: readonly unknown[]): unknown {
  if (typeof binding.invoke !== "function") invalidBinding(`Handler binding ${binding.id} is not executable.`);
  const invoke = binding.invoke as (instance: unknown, ...values: readonly unknown[]) => unknown;
  return invoke(controller, ...input);
}
/** Precompiles generated middleware ordering once during startup. */
export function createMiddlewarePipeline(
  bindings: readonly (MiddlewareBinding | undefined)[],
  ids: readonly number[],
  terminal: (input: unknown) => unknown,
): (input: unknown) => unknown {
  let pipeline = terminal;
  for (let index = ids.length - 1; index >= 0; index--) {
    const middlewareId = ids[index]!;
    const execute = bindings[middlewareId]?.execute;
    if (typeof execute !== "function") invalidBinding(`Middleware binding ${middlewareId} is not executable.`);
    const middleware = execute as RuntimeMiddleware;
    const next = pipeline;
    pipeline = (input: unknown): unknown => {
      let called = false;
      const continuePipeline = (nextInput: unknown = input): unknown => {
        if (called) invalidBinding(`Middleware ${middlewareId} called next() more than once.`);
        called = true;
        return next(nextInput);
      };
      return middleware(input, continuePipeline);
    };
  }
  return pipeline;
}
async function continueGuards(
  first: Promise<boolean>,
  bindings: readonly (GuardBinding | undefined)[],
  ids: readonly number[],
  input: unknown,
  start: number,
): Promise<boolean> {
  const initial = await first;
  if (typeof initial !== "boolean") throw new InvalidGuardResultError(`${RuntimeDiagnosticCode.GUARD_RESULT_INVALID}: Guard returned a non-boolean result.`);
  if (!initial) return false;
  for (let index = start; index < ids.length; index++) {
    const guardId = ids[index]!;
    const execute = bindings[guardId]?.execute;
    if (typeof execute !== "function") invalidBinding(`Guard binding ${guardId} is not executable.`);
    const result = (execute as RuntimeGuard)(input);
    const allowed = isThenable(result) ? await result : result;
    if (typeof allowed !== "boolean") throw new InvalidGuardResultError(`${RuntimeDiagnosticCode.GUARD_RESULT_INVALID}: Guard ${guardId} returned a non-boolean result.`);
    if (!allowed) return false;
  }
  return true;
}
function isThenable(value: unknown): value is Promise<unknown> {
  return typeof value === "object" && value !== null && "then" in value && typeof value.then === "function";
}
function isInvalidResult(value: unknown): value is Readonly<{ valid: false; errors?: unknown }> {
  return typeof value === "object" && value !== null && "valid" in value && value.valid === false;
}
function hasValidatedValue(value: unknown): value is Readonly<{ valid: true; value: unknown }> {
  return typeof value === "object" && value !== null && "valid" in value && value.valid === true && "value" in value;
}
function invalidBinding(message: string): never {
  throw new InvalidApplicationBindingsError(RuntimeDiagnosticCode.INVALID_APPLICATION_BINDINGS, message);
}
