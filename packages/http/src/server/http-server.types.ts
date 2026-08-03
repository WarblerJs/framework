import type { MaybePromise } from "@warbler/transport";
import type { HttpNativeServerOptions } from "../native";
import type { ServerStateValue } from "./server-state";

/** Lifecycle contract for an owned native HTTP server. */
export interface HttpServer {
  readonly state: ServerStateValue;
  start(): MaybePromise<void>;
  stop(closeActiveConnections?: boolean): MaybePromise<void>;
}

/** Options retained by an HTTP server owner. */
export type HttpServerOptions = HttpNativeServerOptions;
