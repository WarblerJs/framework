import { defineMetadata, readMetadata, type Constructor } from "@warbler/core";
import { HttpMetadataKeys, normalizePath } from "../internal";
import type { ControllerMetadata, ControllerOptions } from "./controller.types";

/** Marks a class as an HTTP controller with an optional normalized path prefix and local providers. */
export function Controller(options: string | ControllerOptions = "") {
  return <T extends Constructor>(target: T): T => {
    const metadata = normalizeControllerOptions(options);
    defineMetadata(
      target,
      HttpMetadataKeys.CONTROLLER,
      metadata,
    );
    return target;
  };
}

/** Reads immutable HTTP controller metadata from a class. */
export function getControllerMetadata(target: Constructor): ControllerMetadata | undefined {
  return readMetadata<ControllerMetadata>(target, HttpMetadataKeys.CONTROLLER);
}

function normalizeControllerOptions(options: string | ControllerOptions): ControllerMetadata {
  const prefix = typeof options === "string" ? options : options.prefix ?? "";
  const normalized = normalizePath(prefix);
  const providers = typeof options === "string" ? [] : options.providers ?? [];
  return Object.freeze({
    prefix: normalized === "/" ? "" : normalized,
    providers: Object.freeze([...providers]),
  });
}
