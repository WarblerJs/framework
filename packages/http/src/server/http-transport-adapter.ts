import {
  TransportKind,
  type TransportAdapter,
  type TransportStartContext,
  type TransportStopContext,
} from "@warblerjs/transport";
import type { HttpServerOptions } from "./http-server.types";
import type { HttpServer } from "./http-server.types";
import { createHttpServerOwner } from "./create-http-server-owner";

/** Transport-contract adapter that owns the native HTTP server lifecycle. */
export class HttpTransportAdapter implements TransportAdapter<HttpServerOptions, HttpServer> {
  /** Stable HTTP transport identity. */
  public readonly kind = TransportKind.HTTP;

  /** Creates and starts one native HTTP server owner. */
  public start(context: TransportStartContext<HttpServerOptions>): HttpServer {
    const owner = createHttpServerOwner(context.config);
    owner.start();
    return owner;
  }

  /** Stops the owned native HTTP server. */
  public stop(context: TransportStopContext<HttpServer>): void | Promise<void> {
    return context.native.stop();
  }
}
