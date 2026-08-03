import { freezeDeep } from "../utils/freeze";
import { validateHttpConfig } from "../validator";

/** Validates and deeply freezes HTTP transport configuration. */
export function normalizeHttpConfig<T>(value: T): Readonly<T> {
  validateHttpConfig(value);
  return freezeDeep(value);
}
