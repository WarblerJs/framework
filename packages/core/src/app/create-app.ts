import { GraphDefinitionError } from "../errors";
import { getGraphMetadata } from "../graph";
import type { CreateAppOptions, WarblerApplication } from "./app.types";

/** Creates an immutable Warbler application definition. */
export function createApp(options: CreateAppOptions): WarblerApplication {
  const graphs = [...options.graphs];
  for (const graph of graphs) {
    if (!getGraphMetadata(graph)) throw new GraphDefinitionError(`Class is not decorated with @Graph(): ${graph.name}`);
  }
  return Object.freeze({ graphs: Object.freeze(graphs) });
}
