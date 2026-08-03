import { validateTcp } from "./transport-validation";

/** Validates TCP transport configuration and throws on the first invalid value. */
export function validateTcpConfig(value: unknown): void {
  validateTcp(value);
}
