import { validateUdp } from "./transport-validation";

/** Validates UDP transport configuration and throws on the first invalid value. */
export function validateUdpConfig(value: unknown): void {
  validateUdp(value);
}
