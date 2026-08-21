import { GraphDefinitionError } from "../errors";
import { getGraphMetadata } from "../graph";
import type { Constructor } from "../types";
import type { CreateAppOptions, WarblerApplication } from "./app.types";

/** Creates an immutable Warbler application definition. */
export function createApp(options: CreateAppOptions): WarblerApplication {
  const transports = Object.freeze([...(options.transports ?? [])]);
  if (typeof options.graphs === "string") return Object.freeze({ transports, graphs: options.graphs });
  const graphs = [...options.graphs];
  if (graphs.every((graph): graph is string => typeof graph === "string")) {
    return Object.freeze({ transports, graphs: Object.freeze(graphs) });
  }
  if (graphs.some((graph) => typeof graph === "string")) throw new GraphDefinitionError("createApp().graphs must be graph classes, one glob string, or an array of glob strings.");
  const graphClasses = graphs as Constructor[];
  for (const graph of graphClasses) {
    if (!getGraphMetadata(graph)) throw new GraphDefinitionError(`Class is not decorated with @Graph(): ${graph.name}`);
  }
  return Object.freeze({
    transports,
    graphs: Object.freeze(graphClasses),
  });
}
