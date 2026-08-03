import { validateHttp } from "./transport-validation";

/** Validates HTTP transport configuration and throws on the first invalid value. */
export function validateHttpConfig(value: unknown): void {
  validateHttp(value);
}
