import type { Constructor, ProviderToken } from "@warblerjs/core";
import type { RuntimeProviderRecord, RuntimeRouteHandler } from "./generated-types";

/** Runtime-owned context used by generated factories and Core inject(). */
export interface ProviderBindingContext {
  resolve<T>(token: ProviderToken<T>): T;
  run<T>(callback: () => T): T;
}
export type ProviderBindingFactory<T = unknown> = (context: ProviderBindingContext) => T | Promise<T>;
export interface ProviderBinding<T = unknown> {
  readonly id: number;
  readonly token: ProviderToken<T>;
  readonly scope: "graph" | "root" | "request" | "controller";
  readonly graphId?: number;
  readonly controllerId?: number;
  readonly dependencyIds: readonly number[];
  readonly factory: ProviderBindingFactory<T>;
  readonly dispose?: (instance: T) => void | Promise<void>;
}
export interface ControllerBinding<T = unknown> {
  readonly id: number;
  readonly graphId: number;
  readonly transport: "http" | "websocket";
  readonly token: Constructor<T>;
  readonly providerIds?: readonly number[];
  readonly factory: ProviderBindingFactory<T>;
  readonly dispose?: (instance: T) => void | Promise<void>;
}
export interface HandlerBinding<TController = unknown> {
  readonly id: number;
  readonly kind?: "method" | "function";
  readonly controllerId?: number;
  readonly graphId?: number;
  readonly parameterCount?: number;
  readonly useCaseKeys?: readonly string[];
  readonly useCaseProviderIds?: readonly number[];
  readonly invoke: unknown;
}
export type RuntimeGuardResult = boolean | Response;
export type RuntimeGuard = (input: unknown, context: unknown) => RuntimeGuardResult | Promise<RuntimeGuardResult>;
export type RuntimeMiddlewareNext = (input?: unknown) => unknown;
export type RuntimeMiddleware = (input: unknown, context: unknown, next: RuntimeMiddlewareNext) => unknown;
export type RuntimeValidator = (input: unknown) => unknown;
export interface GuardBinding { readonly id: number; readonly execute: unknown }
export interface MiddlewareBinding { readonly id: number; readonly execute: unknown }
export interface ValidatorBinding { readonly id: number; readonly flags?: number; readonly validate: unknown; readonly onValidationError?: unknown }
export interface GeneratedApplicationDefinition {
  readonly strings: readonly string[];
  readonly graphIds: Readonly<Record<string, number>>;
  readonly providerTable: readonly RuntimeProviderRecord[];
  readonly providerDependencies: readonly number[];
  readonly routeTable: readonly Readonly<Record<string, unknown>>[];
  readonly socketEventTable: readonly Readonly<Record<string, unknown>>[];
  readonly routeGuards?: readonly number[];
  readonly routeMiddleware?: readonly number[];
  readonly socketGuards?: readonly number[];
  readonly socketMiddleware?: readonly number[];
}
export type HttpRouteExecutor = (routeId: number, request: Request, validationInput?: unknown) => Response | Promise<Response>;
export interface GeneratedHttpBindings {
  readonly routes: readonly Readonly<Record<string, unknown>>[];
  readonly createRoutes: (executor: HttpRouteExecutor) => Readonly<Record<string, Readonly<Record<string, RuntimeRouteHandler>>>>;
}
export interface GeneratedWebSocketBindings {
  readonly events: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
}
/** Complete immutable executable contract emitted by Compiler and consumed directly by Runtime. */
export interface GeneratedApplicationBindings {
  readonly application: GeneratedApplicationDefinition;
  readonly providers: readonly ProviderBinding[];
  readonly controllers: readonly ControllerBinding[];
  readonly handlers: readonly HandlerBinding[];
  readonly guards: readonly GuardBinding[];
  readonly middleware: readonly MiddlewareBinding[];
  readonly validators: readonly ValidatorBinding[];
  readonly http?: GeneratedHttpBindings;
  readonly websocket?: GeneratedWebSocketBindings;
}
