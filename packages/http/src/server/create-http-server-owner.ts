import { createBunNativeServer, type HttpNativeServerFactory } from "../native";
import type { HttpServer, HttpServerOptions } from "./http-server.types";
import { HttpServerOwner } from "./http-server-owner";

/** Creates an isolated HTTP server owner with an optional package-local native factory seam. */
export function createHttpServerOwner(
  options: HttpServerOptions,
  factory: HttpNativeServerFactory = createBunNativeServer,
): HttpServer {
  return new HttpServerOwner(options, factory);
}
