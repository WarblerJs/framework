import type { RuntimeConfig } from "../types";
import { validateRuntimeConfig } from "../validator";

/** Validates and converts runtime configuration into its immutable canonical representation. */
export function normalizeRuntimeConfig(value: unknown): RuntimeConfig {
  return validateRuntimeConfig(value);
}
