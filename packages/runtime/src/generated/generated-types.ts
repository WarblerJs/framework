/** Generated provider table record consumed without compiler imports. */
export interface RuntimeProviderRecord {
  readonly id: number;
  readonly nameId: number;
  readonly graphId: number;
  readonly scope: "graph" | "root" | "request";
  readonly dependencyStart: number;
  readonly dependencyCount: number;
}
/** Generated route handler accepted by the native route factory. */
export type RuntimeRouteHandler = (request: Request) => Response | Promise<Response>;
/** Generated socket handler accepted by socket dispatcher factories. */
export type RuntimeSocketHandler = (message: unknown, context: unknown) => unknown;
/** Runtime-facing generated artifacts. */
export interface RuntimeGeneratedApplication {
  readonly strings: readonly string[];
  readonly graphIds: Readonly<Record<string, number>>;
  readonly providerTable: readonly RuntimeProviderRecord[];
  readonly providerDependencies: readonly number[];
  readonly routeTable: readonly Readonly<Record<string, unknown>>[];
  readonly socketEventTable: readonly Readonly<Record<string, unknown>>[];
  readonly createRoutes: (handlers: readonly RuntimeRouteHandler[]) => Readonly<Record<string, Readonly<Record<string, RuntimeRouteHandler>>>>;
  readonly createSocketDispatchers: (handlers: readonly RuntimeSocketHandler[]) => Readonly<Record<number, Readonly<Record<string, RuntimeSocketHandler>>>>;
  readonly createSocketLifecycleHandlers?: (handlers: readonly RuntimeSocketHandler[]) => Readonly<Record<number, Readonly<Record<string, RuntimeSocketHandler>>>>;
}
/** Exact generated module source; no directory discovery is performed. */
export type GeneratedApplicationSource =
  | RuntimeGeneratedApplication
  | (() => RuntimeGeneratedApplication | Promise<RuntimeGeneratedApplication>)
  | string;
