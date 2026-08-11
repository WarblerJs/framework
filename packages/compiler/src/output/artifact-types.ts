/** Dense immutable compiler table entry for a provider. */
export interface ProviderTableEntry {
  readonly id: number; readonly nameId: number; readonly graphId: number; readonly scope: "graph" | "root" | "request";
  readonly dependencyStart: number; readonly dependencyCount: number;
}
/** Dense immutable compiler table entry for a controller. */
export interface ControllerTableEntry {
  readonly id: number; readonly nameId: number; readonly graphId: number; readonly websocket: boolean;
}
/** Dense immutable compiler table entry for an HTTP route. */
export interface RouteTableEntry {
  readonly id: number; readonly methodId: number; readonly pathId: number; readonly controllerId: number;
  readonly handlerId: number; readonly validatorId: number; readonly middlewareStart: number;
  readonly middlewareCount: number; readonly guardStart: number; readonly guardCount: number; readonly flags: number;
  /** String-table id of the route's logical `name`, or `-1` when unnamed. */
  readonly nameId: number;
}
/** Dense immutable compiler table entry for a socket event. */
export interface SocketTableEntry {
  readonly id: number; readonly eventId: number; readonly controllerId: number; readonly handlerId: number;
  readonly validatorId: number; readonly middlewareStart: number; readonly middlewareCount: number;
  readonly guardStart: number; readonly guardCount: number; readonly flags: number; readonly lifecycle: boolean;
}
/** Named compiler reference table entry. */
export interface NamedTableEntry { readonly id: number; readonly nameId: number }
/** Dense immutable event table entry. */
export interface EventTableEntry { readonly id: number; readonly nameId: number; readonly fileId: number; readonly line: number; readonly column: number }
/** Dense immutable listener table entry. */
export interface EventListenerTableEntry { readonly id: number; readonly nameId: number; readonly eventId: number; readonly fileId: number; readonly line: number; readonly column: number }
/** Dense immutable interceptor table entry. */
export interface EventInterceptorTableEntry { readonly id: number; readonly nameId: number; readonly fileId: number; readonly line: number; readonly column: number }
/** Fully optimized Phase 2 compiler artifacts. */
export interface OptimizedApplication {
  readonly strings: readonly string[];
  readonly graphIds: Readonly<Record<string, number>>;
  readonly providers: readonly ProviderTableEntry[];
  readonly providerDependencies: readonly number[];
  readonly controllers: readonly ControllerTableEntry[];
  readonly routes: readonly RouteTableEntry[];
  readonly socketEvents: readonly SocketTableEntry[];
  readonly handlers: readonly NamedTableEntry[];
  readonly validators: readonly NamedTableEntry[];
  readonly middlewares: readonly NamedTableEntry[];
  readonly guards: readonly NamedTableEntry[];
  readonly events: readonly EventTableEntry[];
  readonly eventListeners: readonly EventListenerTableEntry[];
  readonly eventInterceptors: readonly EventInterceptorTableEntry[];
  readonly eventListenerIds: readonly number[];
  readonly routeMiddleware: readonly number[];
  readonly routeGuards: readonly number[];
  readonly socketMiddleware: readonly number[];
  readonly socketGuards: readonly number[];
}
/** Generated TypeScript files keyed by stable output filename. */
export interface GeneratedApplication {
  readonly optimized: OptimizedApplication;
  readonly bindings?: ExecutableBindingPlan;
  readonly files: Readonly<Record<string, string>>;
}
import type { ExecutableBindingPlan } from "../bindings";
