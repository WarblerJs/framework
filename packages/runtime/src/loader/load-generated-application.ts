import { GeneratedArtifactError } from "../errors/runtime-errors";
import type { GeneratedApplicationSource, RuntimeGeneratedApplication } from "../generated/generated-types";

/** Loads one explicitly supplied generated application module and validates its stable contract. */
export async function loadGeneratedApplication(source: GeneratedApplicationSource): Promise<RuntimeGeneratedApplication> {
  let candidate: unknown;
  try {
    if (typeof source === "string") candidate = await import(source);
    else if (typeof source === "function") candidate = await source();
    else candidate = source;
  } catch (cause) {
    throw new GeneratedArtifactError("Unable to load generated application artifacts.", { cause });
  }
  const value = unwrapDefault(candidate);
  if (!isGeneratedApplication(value)) throw new GeneratedArtifactError("Generated application artifacts have an invalid contract.");
  return freezeGeneratedApplication(value);
}

function unwrapDefault(value: unknown): unknown {
  if (typeof value === "object" && value !== null && "default" in value) return value.default;
  return value;
}
function isGeneratedApplication(value: unknown): value is RuntimeGeneratedApplication {
  if (typeof value !== "object" || value === null) return false;
  return hasArray(value, "strings") &&
    hasRecord(value, "graphIds") &&
    hasArray(value, "providerTable") &&
    hasArray(value, "providerDependencies") &&
    hasArray(value, "routeTable") &&
    hasArray(value, "socketEventTable") &&
    hasFunction(value, "createRoutes") &&
    hasFunction(value, "createSocketDispatchers");
}
function hasArray(value: object, key: string): boolean {
  return key in value && Array.isArray((value as Readonly<Record<string, unknown>>)[key]);
}
function hasRecord(value: object, key: string): boolean {
  const item = (value as Readonly<Record<string, unknown>>)[key];
  return typeof item === "object" && item !== null && !Array.isArray(item);
}
function hasFunction(value: object, key: string): boolean {
  return typeof (value as Readonly<Record<string, unknown>>)[key] === "function";
}
function freezeGeneratedApplication(value: RuntimeGeneratedApplication): RuntimeGeneratedApplication {
  return Object.freeze({
    strings: value.strings,
    graphIds: value.graphIds,
    providerTable: value.providerTable,
    providerDependencies: value.providerDependencies,
    routeTable: value.routeTable,
    socketEventTable: value.socketEventTable,
    createRoutes: value.createRoutes,
    createSocketDispatchers: value.createSocketDispatchers,
    ...(value.createSocketLifecycleHandlers === undefined
      ? {}
      : { createSocketLifecycleHandlers: value.createSocketLifecycleHandlers }),
  });
}
