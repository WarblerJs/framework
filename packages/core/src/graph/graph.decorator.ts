import { GraphDefinitionError } from "../errors";
import { defineMetadata, MetadataKeys, readMetadata } from "../metadata";
import { Transport } from "../transport";
import type { Constructor } from "../types";
import type { GraphMetadata, GraphOptions } from "./graph.types";

function normalizePath(value: string | undefined): string {
  if (!value || value === "/") return "";
  if (!value.startsWith("/")) throw new GraphDefinitionError(`Graph path must start with '/': ${value}`);
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

/** Marks a class as a Warbler graph. HTTP is the default transport. */
export function Graph(options: GraphOptions = {}) {
  return <T extends Constructor>(target: T): T => {
    const metadata: GraphMetadata = Object.freeze({
      prefix: normalizePath(options.prefix),
      transport: options.transport ?? Transport.HTTP,
      controllers: Object.freeze([...(options.controllers ?? [])]),
      providers: Object.freeze([...(options.providers ?? [])]), 
      middleware: Object.freeze([...(options.middleware ?? [])]),
    });

    defineMetadata(target, MetadataKeys.GRAPH, metadata);

    return target;
  };
}

/** Reads normalized graph metadata from a graph class. */
export function getGraphMetadata(target: Constructor): GraphMetadata | undefined {
  return readMetadata<GraphMetadata>(target, MetadataKeys.GRAPH);
}
