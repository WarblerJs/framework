import { defineMetadata, readMetadata, type Constructor } from "@warbler/core";
import { HttpMetadataKeys, normalizePath } from "../internal";
import type { ControllerMetadata } from "./controller.types";

/** Marks a class as an HTTP controller with an optional normalized path prefix. */
export function Controller(prefix = "") {
  return <T extends Constructor>(target: T): T => {
    defineMetadata(
      target,
      HttpMetadataKeys.CONTROLLER,
      Object.freeze({ prefix: normalizePath(prefix) === "/" ? "" : normalizePath(prefix) }),
    );
    return target;
  };
}

/** Reads immutable HTTP controller metadata from a class. */
export function getControllerMetadata(target: Constructor): ControllerMetadata | undefined {
  return readMetadata<ControllerMetadata>(target, HttpMetadataKeys.CONTROLLER);
}
