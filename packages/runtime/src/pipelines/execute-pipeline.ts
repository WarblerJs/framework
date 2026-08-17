import { InvalidApplicationBindingsError, InvalidGuardResultError } from "../errors/runtime-errors";
import { RuntimeDiagnosticCode } from "../diagnostics/runtime-diagnostic-codes";
import type {
  GuardBinding,
  HandlerBinding,
  MiddlewareBinding,
  RuntimeGuard,
  RuntimeGuardResult,
  RuntimeMiddleware,
  ValidatorBinding,
} from "../generated/executable-bindings";

/** Startup-linked immutable guard execution plan shared by routes with the same guard sequence. */
export interface CompiledGuardPipeline {
  readonly ids: readonly number[];
  execute(input: unknown, context: unknown): RuntimeGuardResult | Promise<RuntimeGuardResult>;
}
/** Compiler/startup-local registry used to deduplicate equal guard ID sequences safely. */
export interface GuardPipelineRegistry {
  readonly pipelines: Map<string, CompiledGuardPipeline>;
}
const EMPTY_GUARD_IDS: readonly number[] = Object.freeze([]);
const EMPTY_GUARD_PIPELINE: CompiledGuardPipeline = Object.freeze({
  ids: EMPTY_GUARD_IDS,
  execute: () => true,
});

/** Creates one startup-local guard pipeline registry. Do not retain request state in it. */
export function createGuardPipelineRegistry(): GuardPipelineRegistry {
  return { pipelines: new Map() };
}

/** Links and deduplicates one ordered guard ID sequence against validated guard bindings. */
export function linkGuardPipeline(
  bindings: readonly (GuardBinding | undefined)[],
  ids: readonly number[],
  registry: GuardPipelineRegistry,
): CompiledGuardPipeline {
  if (ids.length === 0) return EMPTY_GUARD_PIPELINE;
  const key = guardPipelineKey(ids);
  const existing = registry.pipelines.get(key);
  if (existing !== undefined) return existing;
  const guardIds = new Array<number>(ids.length);
  const guards = new Array<RuntimeGuard>(ids.length);
  for (let index = 0, length = ids.length; index < length; index++) {
    const guardId = ids[index]!;
    const execute = bindings[guardId]?.execute;
    if (typeof execute !== "function") invalidBinding(`Guard binding ${guardId} is not executable.`);
    guardIds[index] = guardId;
    guards[index] = execute as RuntimeGuard;
  }
  const frozenIds = Object.freeze(guardIds);
  const frozenGuards = Object.freeze(guards);
  const pipeline = Object.freeze({
    ids: frozenIds,
    execute: (input: unknown, context: unknown): RuntimeGuardResult | Promise<RuntimeGuardResult> =>
      executeCompiledGuardPipeline(frozenIds, frozenGuards, input, context),
  });
  registry.pipelines.set(key, pipeline);
  return pipeline;
}

/** Executes generated Guards in order while retaining a synchronous fast path. */
export function executeGuardRange(bindings: readonly (GuardBinding | undefined)[], ids: readonly number[], input: unknown, context: unknown): RuntimeGuardResult | Promise<RuntimeGuardResult> {
  for (let index = 0; index < ids.length; index++) {
    const guardId = ids[index]!;
    const execute = bindings[guardId]?.execute;
    if (typeof execute !== "function") invalidBinding(`Guard binding ${guardId} is not executable.`);
    const result = (execute as RuntimeGuard)(input, context);
    if (isThenable(result)) return continueGuards(result, bindings, ids, input, context, index + 1);
    if (result === true) continue;
    if (result === false || result instanceof Response) return result;
    invalidGuardResult(`Guard ${guardId} returned an invalid result.`);
  }
  return true;
}
/** Executes one generated Validator without schema reconstruction. */
export function executeValidator(
  binding: ValidatorBinding | undefined,
  input: unknown,
): NormalizedValidationOutcome | Promise<NormalizedValidationOutcome> {
  if (binding === undefined) return Object.freeze({ valid: true, value: input });
  if (typeof binding.validate !== "function") invalidBinding(`Validator binding ${binding.id} is not executable.`);
  const result = (binding.validate as (value: unknown) => unknown)(input);
  if (isThenable(result)) return result.then((value) => normalizeValidation(value, input));
  return normalizeValidation(result, input);
}
interface NormalizedValidationOutcome {
  readonly valid: boolean;
  readonly value: unknown;
  readonly errors?: unknown;
  readonly query?: unknown;
  readonly path?: unknown;
  readonly headers?: unknown;
  readonly cookies?: unknown;
  readonly message?: unknown;
  readonly metadata?: unknown;
}
function normalizeValidation(result: unknown, input?: unknown): NormalizedValidationOutcome {
  if (result === false) return Object.freeze({ valid: false, value: undefined });
  if (isInvalidResult(result)) return Object.freeze({ valid: false, value: undefined, ...("errors" in result ? { errors: result.errors } : {}) });
  if (result === true) return Object.freeze({ valid: true, value: input });
  if (hasValidatedValue(result)) return Object.freeze({
    valid: true,
    value: result.value,
    ...copyValidatedSections(result),
  });
  return Object.freeze({ valid: true, value: result });
}
function copyValidatedSections(result: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  const sections: Record<string, unknown> = {};
  for (const key of ["query", "path", "headers", "cookies", "message", "metadata"] as const) {
    if (key in result) sections[key] = result[key];
  }
  return sections;
}
/** Executes one direct generated Handler binding. */
export function executeHandler(binding: HandlerBinding, controller: unknown, input: readonly unknown[]): unknown {
  if (typeof binding.invoke !== "function") invalidBinding(`Handler binding ${binding.id} is not executable.`);
  const invoke = binding.invoke as (instance: unknown, ...values: readonly unknown[]) => unknown;
  return invoke(controller, ...input);
}
/**
 * Precompiles generated middleware ordering once during startup. `context` is
 * threaded through at call time (not build time) since it's request-scoped, while
 * the pipeline closure itself is built once and reused across every request.
 */
export function createMiddlewarePipeline(
  bindings: readonly (MiddlewareBinding | undefined)[],
  ids: readonly number[],
  terminal: (input: unknown, context: unknown) => unknown,
): (input: unknown, context: unknown) => unknown {
  let pipeline = terminal;
  for (let index = ids.length - 1; index >= 0; index--) {
    const middlewareId = ids[index]!;
    const execute = bindings[middlewareId]?.execute;
    if (typeof execute !== "function") invalidBinding(`Middleware binding ${middlewareId} is not executable.`);
    const middleware = execute as RuntimeMiddleware;
    const next = pipeline;
    pipeline = (input: unknown, context: unknown): unknown => {
      let called = false;
      const continuePipeline = (nextInput: unknown = input): unknown => {
        if (called) invalidBinding(`Middleware ${middlewareId} called next() more than once.`);
        called = true;
        return next(nextInput, context);
      };
      return middleware(input, context, continuePipeline);
    };
  }
  return pipeline;
}
function executeCompiledGuardPipeline(
  ids: readonly number[],
  guards: readonly RuntimeGuard[],
  input: unknown,
  context: unknown,
): RuntimeGuardResult | Promise<RuntimeGuardResult> {
  for (let index = 0, length = guards.length; index < length; index++) {
    const result = guards[index]!(input, context);
    if (isThenable(result)) return continueCompiledGuards(result, guards, ids, input, context, index + 1);
    if (result === true) continue;
    if (result === false || result instanceof Response) return result;
    invalidGuardResult(`Guard ${ids[index]!} returned an invalid result.`);
  }
  return true;
}
async function continueGuards(
  first: Promise<RuntimeGuardResult>,
  bindings: readonly (GuardBinding | undefined)[],
  ids: readonly number[],
  input: unknown,
  context: unknown,
  start: number,
): Promise<RuntimeGuardResult> {
  const initial = await first;
  if (initial !== true) {
    if (initial === false || initial instanceof Response) return initial;
    invalidGuardResult("Guard returned an invalid result.");
  }
  for (let index = start; index < ids.length; index++) {
    const guardId = ids[index]!;
    const execute = bindings[guardId]?.execute;
    if (typeof execute !== "function") invalidBinding(`Guard binding ${guardId} is not executable.`);
    const result = (execute as RuntimeGuard)(input, context);
    const allowed = isThenable(result) ? await result : result;
    if (allowed === true) continue;
    if (allowed === false || allowed instanceof Response) return allowed;
    invalidGuardResult(`Guard ${guardId} returned an invalid result.`);
  }
  return true;
}
async function continueCompiledGuards(
  first: Promise<RuntimeGuardResult>,
  guards: readonly RuntimeGuard[],
  ids: readonly number[],
  input: unknown,
  context: unknown,
  start: number,
): Promise<RuntimeGuardResult> {
  const initial = await first;
  if (initial !== true) {
    if (initial === false || initial instanceof Response) return initial;
    invalidGuardResult("Guard returned an invalid result.");
  }
  for (let index = start, length = guards.length; index < length; index++) {
    const result = guards[index]!(input, context);
    const allowed = isThenable(result) ? await result : result;
    if (allowed === true) continue;
    if (allowed === false || allowed instanceof Response) return allowed;
    invalidGuardResult(`Guard ${ids[index]!} returned an invalid result.`);
  }
  return true;
}
function guardPipelineKey(ids: readonly number[]): string {
  let key = "";
  for (let index = 0, length = ids.length; index < length; index++) key += index === 0 ? String(ids[index]!) : `,${ids[index]!}`;
  return key;
}
function isThenable(value: unknown): value is Promise<unknown> {
  return typeof value === "object" && value !== null && "then" in value && typeof value.then === "function";
}
function isInvalidResult(value: unknown): value is Readonly<{ valid: false; errors?: unknown }> {
  return typeof value === "object" && value !== null && "valid" in value && value.valid === false;
}
function hasValidatedValue(value: unknown): value is Readonly<{ valid: true; value: unknown }> & Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && "valid" in value && value.valid === true && "value" in value;
}
function invalidBinding(message: string): never {
  throw new InvalidApplicationBindingsError(RuntimeDiagnosticCode.INVALID_APPLICATION_BINDINGS, message);
}
function invalidGuardResult(message: string): never {
  throw new InvalidGuardResultError(`${RuntimeDiagnosticCode.GUARD_RESULT_INVALID}: ${message}`);
}
