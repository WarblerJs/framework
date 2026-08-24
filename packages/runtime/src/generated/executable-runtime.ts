import { Container, runInInjectionContext } from "@warblerjs/core";
import { GeneratedArtifactError, RuntimeProviderNotFoundError } from "../errors/runtime-errors";
import type {
  ControllerBinding,
  GeneratedApplicationBindings,
  HandlerBinding,
  ProviderBinding,
  ProviderBindingContext,
} from "./executable-bindings";

/** Direct numeric-ID executor for one compiler-generated executable manifest. */
export class ExecutableBindingsRuntime {
  readonly #bindings: GeneratedApplicationBindings;
  readonly #root = new Container();
  readonly #graphs = new Map<number, Container>();
  readonly #controllers: unknown[] = [];
  readonly #controllerContainers: Array<Container | undefined> = [];
  readonly #controllerBindings: readonly (ControllerBinding | undefined)[];
  readonly #handlerBindings: readonly (HandlerBinding | undefined)[];

  public constructor(bindings: GeneratedApplicationBindings) {
    validateBindings(bindings);
    this.#bindings = bindings;
    this.#controllerBindings = denseById(bindings.controllers);
    this.#handlerBindings = denseById(bindings.handlers);
    for (const graphId of Object.values(bindings.application.graphIds)) this.#graphs.set(graphId, new Container(this.#root));
    for (const binding of bindings.providers) if (binding.scope !== "controller") this.#registerProvider(binding);
    for (const binding of bindings.controllers) {
      const container = this.#graph(binding.graphId);
      container.register({ token: binding.token, useFactory: () => this.controller(binding.id) });
    }
  }

  /** Resolves a generated provider using Graph then Root scope. */
  public resolveProvider(graphId: number, providerId: number): unknown {
    const binding = this.#bindings.providers[providerId];
    if (binding === undefined || binding.id !== providerId) throw new RuntimeProviderNotFoundError(`Generated provider binding not found: ${providerId}`);
    if (binding.scope === "controller") {
      const controllerId = binding.controllerId;
      if (controllerId === undefined) throw new RuntimeProviderNotFoundError(`Generated controller provider has no Controller owner: ${providerId}`);
      this.controller(controllerId);
      const container = this.#controllerContainers[controllerId];
      if (container === undefined) throw new RuntimeProviderNotFoundError(`Generated Controller container not found: ${controllerId}`);
      return container.resolve(binding.token);
    }
    return (binding.scope === "root" ? this.#root : this.#graph(graphId)).resolve(binding.token);
  }

  /** Returns the cached Graph-owned controller for a numeric ID. */
  public controller(controllerId: number): unknown {
    if (controllerId in this.#controllers) return this.#controllers[controllerId];
    const binding = this.#controllerBindings[controllerId];
    if (binding === undefined) throw new GeneratedArtifactError(`Generated controller binding not found: ${controllerId}`);
    const graph = this.#graph(binding.graphId);
    const container = new Container(graph);
    this.#registerControllerProviders(container, binding);
    const value = binding.factory(bindingContext(container));
    container.register({ token: binding.token, useValue: value });
    this.#controllerContainers[controllerId] = container;
    this.#controllers[controllerId] = value;
    return value;
  }

  /** Invokes one precompiled direct handler without method-name lookup. */
  public invoke(handlerId: number, ...input: readonly unknown[]): unknown {
    const binding = this.#handlerBindings[handlerId];
    if (binding === undefined || typeof binding.invoke !== "function") throw new GeneratedArtifactError(`Generated handler binding not found: ${handlerId}`);
    const invoke = binding.invoke as (controller: unknown, ...values: readonly unknown[]) => unknown;
    return invoke(binding.controllerId === undefined ? undefined : this.controller(binding.controllerId), ...this.#handlerInput(binding, input));
  }

  /** Creates Bun-native route objects whose functions dispatch by precompiled route ID. */
  public createHttpRoutes(): Readonly<Record<string, Readonly<Record<string, (request: Request) => Response | Promise<Response>>>>> {
    const http = this.#bindings.http;
    if (http === undefined) return Object.freeze({});
    return http.createRoutes((routeId, request) => {
      const route = this.#bindings.application.routeTable[routeId];
      const handlerId = numericField(route, "handlerId");
      const result = this.invoke(handlerId, request);
      if (result instanceof Response || isPromiseResponse(result)) return result;
      throw new GeneratedArtifactError(`HTTP handler ${handlerId} returned an invalid response.`);
    });
  }

  /** Dispatches one precompiled WebSocket event by direct object lookup. */
  public invokeSocketEvent(event: string, message: unknown, context: unknown): unknown {
    const record = this.#bindings.websocket?.events[event];
    if (record === undefined) return undefined;
    return this.invoke(numericField(record, "handlerId"), message, context);
  }

  #registerProvider(binding: ProviderBinding): void {
    const container = binding.scope === "root" ? this.#root : this.#graph(requiredGraphId(binding));
    container.register({ token: binding.token, useFactory: () => binding.factory(bindingContext(container)) });
  }
  #registerControllerProviders(container: Container, controller: ControllerBinding): void {
    const providerIds = controller.providerIds ?? Object.freeze([]);
    for (const providerId of providerIds) {
      const binding = this.#bindings.providers[providerId];
      if (binding === undefined || binding.scope !== "controller" || binding.controllerId !== controller.id) throw new GeneratedArtifactError(`Generated Controller provider binding not found: ${providerId}`);
      container.register({ token: binding.token, useFactory: () => binding.factory(bindingContext(container)) });
    }
  }
  #graph(graphId: number): Container {
    const graph = this.#graphs.get(graphId);
    if (graph === undefined) throw new RuntimeProviderNotFoundError(`Generated Graph container not found: ${graphId}`);
    return graph;
  }
  #handlerInput(binding: HandlerBinding, input: readonly unknown[]): readonly unknown[] {
    const providerIds = binding.useCaseProviderIds;
    if (providerIds === undefined || providerIds.length === 0) return input;
    const keys = binding.useCaseKeys;
    if (keys === undefined || keys.length !== providerIds.length || binding.graphId === undefined) throw new GeneratedArtifactError(`Generated handler use-case metadata is invalid: ${binding.id}`);
    const useCases: Record<string, unknown> = Object.create(null);
    for (let index = 0, length = providerIds.length; index < length; index++) useCases[keys[index]!] = this.resolveProvider(binding.graphId, providerIds[index]!);
    const inputLength = input.length;
    const result = new Array<unknown>(inputLength + 1);
    for (let index = 0; index < inputLength; index++) result[index] = input[index];
    result[inputLength] = Object.freeze(useCases);
    return Object.freeze(result);
  }
}

/** Creates a Runtime executor directly from the generated root manifest. */
export function createExecutableBindingsRuntime(bindings: GeneratedApplicationBindings): ExecutableBindingsRuntime {
  return new ExecutableBindingsRuntime(bindings);
}
function bindingContext(container: Container): ProviderBindingContext {
  return Object.freeze({
    resolve: <T>(token: Parameters<Container["resolve"]>[0]): T => container.resolve(token) as T,
    run: <T>(callback: () => T): T => runInInjectionContext(container, callback),
  });
}
function denseById<T extends { readonly id: number }>(values: readonly T[]): readonly (T | undefined)[] {
  const result: Array<T | undefined> = [];
  for (const value of values) {
    if (!Number.isSafeInteger(value.id) || value.id < 0 || result[value.id] !== undefined) throw new GeneratedArtifactError(`Duplicate or invalid generated binding ID: ${value.id}`);
    result[value.id] = value;
  }
  return Object.freeze(result);
}
function validateBindings(value: GeneratedApplicationBindings): void {
  if (!Array.isArray(value.providers) || !Array.isArray(value.controllers) || !Array.isArray(value.handlers)) throw new GeneratedArtifactError("Generated executable bindings have an invalid contract.");
  denseById(value.providers); denseById(value.controllers); denseById(value.handlers);
}
function requiredGraphId(binding: ProviderBinding): number {
  if (binding.graphId === undefined || binding.graphId < 0) throw new GeneratedArtifactError(`Graph provider ${binding.id} has no Graph owner.`);
  return binding.graphId;
}
function numericField(record: Readonly<Record<string, unknown>> | undefined, key: string): number {
  const value = record?.[key];
  if (typeof value !== "number" || !Number.isSafeInteger(value)) throw new GeneratedArtifactError(`Generated route has invalid ${key}.`);
  return value;
}
function isPromiseResponse(value: unknown): value is Promise<Response> {
  return typeof value === "object" && value !== null && "then" in value && typeof value.then === "function";
}
