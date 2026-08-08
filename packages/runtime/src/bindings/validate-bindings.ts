import { RuntimeDiagnosticCode } from "../diagnostics/runtime-diagnostic-codes";
import { InvalidApplicationBindingsError } from "../errors/runtime-errors";
import type {
  ControllerBinding,
  GeneratedApplicationBindings,
  HandlerBinding,
  ProviderBinding,
  GuardBinding,
  MiddlewareBinding,
  ValidatorBinding,
} from "../generated/executable-bindings";

/** Dense, validated binding indexes built exactly once at startup. */
export interface ValidatedBindingIndexes {
  readonly providers: readonly (ProviderBinding | undefined)[];
  readonly controllers: readonly (ControllerBinding | undefined)[];
  readonly handlers: readonly (HandlerBinding | undefined)[];
  readonly guards: readonly (GuardBinding | undefined)[];
  readonly middleware: readonly (MiddlewareBinding | undefined)[];
  readonly validators: readonly (ValidatorBinding | undefined)[];
}

/** Validates every generated reference and creates direct numeric indexes. */
export function validateApplicationBindings(application: GeneratedApplicationBindings): ValidatedBindingIndexes {
  if (!isObject(application) || !isObject(application.application)) fail(RuntimeDiagnosticCode.INVALID_APPLICATION_BINDINGS, "Generated application bindings are malformed.");
  const graphIds = new Set(Object.values(application.application.graphIds));
  for (const graphId of graphIds) safeId(graphId, "graphId");
  const providers = dense(application.providers, "provider");
  const controllers = dense(application.controllers, "controller");
  const handlers = dense(application.handlers, "handler");
  const guards = dense(application.guards, "guard");
  const middleware = dense(application.middleware, "middleware");
  const validators = dense(application.validators, "validator");
  for (const binding of application.guards) if (typeof binding.execute !== "function") fail(RuntimeDiagnosticCode.INVALID_APPLICATION_BINDINGS, "Guard binding is not executable.", { bindingId: binding.id });
  for (const binding of application.middleware) if (typeof binding.execute !== "function") fail(RuntimeDiagnosticCode.INVALID_APPLICATION_BINDINGS, "Middleware binding is not executable.", { bindingId: binding.id });
  for (const binding of application.validators) {
    if (typeof binding.validate !== "function") fail(RuntimeDiagnosticCode.INVALID_APPLICATION_BINDINGS, "Validator binding is not executable.", { bindingId: binding.id });
    if (binding.onValidationError !== undefined && typeof binding.onValidationError !== "function") {
      fail(RuntimeDiagnosticCode.INVALID_APPLICATION_BINDINGS, "Validator onValidationError binding is not executable.", { bindingId: binding.id });
    }
  }
  if (application.application.providerTable.length !== application.providers.length) fail(RuntimeDiagnosticCode.INVALID_APPLICATION_BINDINGS, "Provider table count does not match executable bindings.");

  for (const binding of application.providers) {
    if (binding.scope === "root") {
      if (binding.graphId !== undefined) fail(RuntimeDiagnosticCode.PROVIDER_SCOPE_VIOLATION, "Root provider has Graph ownership.", { providerId: binding.id });
    } else if (binding.scope === "graph" || binding.scope === "request") {
      if (binding.graphId === undefined || !graphIds.has(binding.graphId)) fail(RuntimeDiagnosticCode.PROVIDER_SCOPE_VIOLATION, "Graph provider has invalid ownership.", { providerId: binding.id });
    } else fail(RuntimeDiagnosticCode.PROVIDER_SCOPE_VIOLATION, "Provider scope is invalid.", { providerId: binding.id });
    for (const dependencyId of binding.dependencyIds) {
      safeId(dependencyId, "dependencyId");
      if (providers[dependencyId] === undefined) fail(RuntimeDiagnosticCode.PROVIDER_NOT_FOUND, "Provider dependency binding is missing.", { providerId: binding.id, dependencyId });
      const dependency = providers[dependencyId]!;
      if (binding.scope === "root" && dependency.scope !== "root") fail(RuntimeDiagnosticCode.PROVIDER_SCOPE_VIOLATION, "Root provider cannot depend on a Graph provider.", { providerId: binding.id, dependencyId });
      if ((binding.scope === "graph" || binding.scope === "root") && dependency.scope === "request") {
        fail(RuntimeDiagnosticCode.PROVIDER_SCOPE_VIOLATION, "Startup-scoped provider cannot depend on a request-scoped provider.", { providerId: binding.id, dependencyId });
      }
      if (
        (binding.scope === "graph" || binding.scope === "request") &&
        (dependency.scope === "graph" || dependency.scope === "request") &&
        dependency.graphId !== binding.graphId
      ) {
        fail(RuntimeDiagnosticCode.PROVIDER_SCOPE_VIOLATION, "Provider dependency belongs to another Graph.", { providerId: binding.id, dependencyId });
      }
    }
  }
  for (const binding of application.controllers) {
    if (!graphIds.has(binding.graphId)) fail(RuntimeDiagnosticCode.INVALID_APPLICATION_BINDINGS, "Controller Graph does not exist.", { controllerId: binding.id, graphId: binding.graphId });
    if (binding.transport !== "http" && binding.transport !== "websocket") fail(RuntimeDiagnosticCode.INVALID_APPLICATION_BINDINGS, "Controller transport is invalid.", { controllerId: binding.id });
  }
  for (const binding of application.handlers) {
    if (controllers[binding.controllerId] === undefined || typeof binding.invoke !== "function") {
      fail(RuntimeDiagnosticCode.HANDLER_BINDING_INVALID, "Handler binding references an invalid Controller or invocation.", { handlerId: binding.id, controllerId: binding.controllerId });
    }
  }
  validateRouteRecords(application, handlers);
  validateSocketRecords(application, handlers);
  return Object.freeze({ providers, controllers, handlers, guards, middleware, validators });
}

function validateRouteRecords(application: GeneratedApplicationBindings, handlers: readonly (HandlerBinding | undefined)[]): void {
  const ids = new Set<number>();
  for (const record of application.application.routeTable) {
    const routeId = field(record, "id");
    if (routeId >= application.application.routeTable.length || ids.has(routeId)) fail(RuntimeDiagnosticCode.DUPLICATE_BINDING_ID, "HTTP route ID is duplicate or out of bounds.", { routeId });
    ids.add(routeId);
    const handlerId = field(record, "handlerId");
    const controllerId = field(record, "controllerId");
    if (handlers[handlerId] === undefined || handlers[handlerId]!.controllerId !== controllerId) fail(RuntimeDiagnosticCode.HANDLER_BINDING_INVALID, "HTTP route handler reference is invalid.", { routeId, handlerId, controllerId });
    validateOptionalId(record, "validatorId", application.validators.length, routeId);
    validateRange(record, "guardStart", "guardCount", application.application.routeGuards, application.guards.length, routeId);
    validateRange(record, "middlewareStart", "middlewareCount", application.application.routeMiddleware, application.middleware.length, routeId);
  }
  for (const record of application.http?.routes ?? Object.freeze([])) {
    const routeId = field(record, "id");
    if (!ids.has(routeId)) fail(RuntimeDiagnosticCode.INVALID_APPLICATION_BINDINGS, "HTTP executable route references an unknown route.", { routeId });
  }
}
function validateSocketRecords(application: GeneratedApplicationBindings, handlers: readonly (HandlerBinding | undefined)[]): void {
  const ids = new Set<number>();
  for (const record of application.application.socketEventTable) {
    const eventId = field(record, "id");
    if (eventId >= application.application.socketEventTable.length || ids.has(eventId)) fail(RuntimeDiagnosticCode.DUPLICATE_BINDING_ID, "WebSocket event ID is duplicate or out of bounds.", { eventId });
    ids.add(eventId);
    const handlerId = field(record, "handlerId");
    if (handlers[handlerId] === undefined) fail(RuntimeDiagnosticCode.HANDLER_BINDING_INVALID, "WebSocket event handler reference is invalid.", { eventId, handlerId });
    validateOptionalId(record, "validatorId", application.validators.length, eventId);
    validateRange(record, "guardStart", "guardCount", application.application.socketGuards, application.guards.length, eventId);
    validateRange(record, "middlewareStart", "middlewareCount", application.application.socketMiddleware, application.middleware.length, eventId);
  }
  const events: Readonly<Record<string, Readonly<Record<string, unknown>>>> = application.websocket?.events ?? Object.freeze({});
  for (const record of Object.values(events)) {
    const eventId = field(record, "id");
    if (!ids.has(eventId)) fail(RuntimeDiagnosticCode.INVALID_APPLICATION_BINDINGS, "WebSocket executable event references an unknown event.", { eventId });
  }
}
function validateRange(
  record: Readonly<Record<string, unknown>>,
  startKey: string,
  countKey: string,
  ids: readonly number[] | undefined,
  bindingCount: number,
  ownerId: number,
): void {
  const start = field(record, startKey);
  const count = field(record, countKey);
  if (count === 0) return;
  if (ids === undefined || start + count > ids.length) fail(RuntimeDiagnosticCode.INVALID_APPLICATION_BINDINGS, `Generated ${startKey} range is invalid.`, { ownerId });
  for (let index = start; index < start + count; index++) {
    const id = ids[index];
    if (id === undefined || id < 0 || id >= bindingCount) fail(RuntimeDiagnosticCode.INVALID_APPLICATION_BINDINGS, `Generated ${startKey} binding ID is invalid.`, { ownerId });
  }
}
function validateOptionalId(record: Readonly<Record<string, unknown>>, key: string, count: number, ownerId: number): void {
  const value = field(record, key, true);
  if (value !== -1 && value >= count) fail(RuntimeDiagnosticCode.INVALID_APPLICATION_BINDINGS, `Generated ${key} is invalid.`, { ownerId });
}
function dense<T extends { readonly id: number }>(values: readonly T[], kind: string): readonly (T | undefined)[] {
  if (!Array.isArray(values)) fail(RuntimeDiagnosticCode.INVALID_APPLICATION_BINDINGS, `Generated ${kind} bindings are not an array.`);
  const result: Array<T | undefined> = [];
  for (const value of values) {
    safeId(value.id, `${kind}Id`);
    if (value.id >= values.length) fail(RuntimeDiagnosticCode.INVALID_APPLICATION_BINDINGS, `Generated ${kind} binding ID is out of bounds.`, { bindingId: value.id });
    if (result[value.id] !== undefined) fail(RuntimeDiagnosticCode.DUPLICATE_BINDING_ID, `Duplicate generated ${kind} binding ID.`, { bindingId: value.id });
    result[value.id] = value;
  }
  return Object.freeze(result);
}
function field(record: Readonly<Record<string, unknown>>, key: string, allowMissing = false): number {
  const value = record[key];
  if (typeof value !== "number") fail(RuntimeDiagnosticCode.INVALID_APPLICATION_BINDINGS, `Generated record field "${key}" is invalid.`);
  safeId(value, key, allowMissing);
  return value;
}
function safeId(value: number, name: string, allowMissing = false): void {
  if (!Number.isSafeInteger(value) || value < (allowMissing ? -1 : 0)) fail(RuntimeDiagnosticCode.INVALID_APPLICATION_BINDINGS, `Generated ${name} is invalid.`);
}
function isObject(value: unknown): value is Readonly<Record<string, unknown>> { return typeof value === "object" && value !== null; }
function fail(code: string, message: string, metadata: Readonly<Record<string, number | string>> = Object.freeze({})): never {
  throw new InvalidApplicationBindingsError(code, message, metadata);
}
