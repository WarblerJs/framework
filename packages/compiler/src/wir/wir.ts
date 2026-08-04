/** Source location retained in WIR metadata. */
export interface SourceLocationWIR {
  readonly file: string;
  readonly line: number;
  readonly column: number;
}
/** HTTP route metadata. */
export interface RouteWIR extends SourceLocationWIR {
  readonly method: string;
  readonly path: string;
  readonly handler: string;
  readonly validator?: string;
  readonly middleware: readonly string[];
  readonly guards: readonly string[];
  readonly csrf: boolean;
  readonly stream?: "sse" | "html";
  readonly response?: "static" | "view" | "json" | "html";
}
/** Socket subscription or lifecycle metadata. */
export interface SocketEventWIR extends SourceLocationWIR {
  readonly kind: "event" | "lifecycle";
  readonly event: string;
  readonly handler: string;
  readonly validator?: string;
  readonly middleware: readonly string[];
  readonly guards: readonly string[];
  readonly compression: boolean;
  readonly binary: boolean;
  readonly authentication: boolean;
  readonly rateLimit: boolean;
}
/** Controller metadata owned by a Graph. */
export interface ControllerWIR extends SourceLocationWIR {
  readonly name: string;
  readonly kind: "http" | "websocket";
  readonly prefix: string;
  readonly routes: readonly RouteWIR[];
  readonly socketEvents: readonly SocketEventWIR[];
}
/** Provider metadata owned by a Graph or the application root. */
export interface ProviderWIR extends SourceLocationWIR {
  readonly name: string;
  readonly kind: "service" | "repository" | "factory" | "resolver" | "gateway" | "injectable";
  readonly provide: "graph" | "root";
  readonly dependencies: readonly string[];
}
/** Graph metadata and its owned application declarations. */
export interface GraphWIR extends SourceLocationWIR {
  readonly name: string;
  readonly prefix: string;
  readonly transport: string;
  readonly controllers: readonly ControllerWIR[];
  readonly providers: readonly ProviderWIR[];
}
/** Phase 1 Warbler Intermediate Representation. */
export interface ApplicationWIR {
  readonly version: 1;
  readonly projectRoot: string;
  readonly graphs: readonly GraphWIR[];
  readonly rootProviders: readonly ProviderWIR[];
}
