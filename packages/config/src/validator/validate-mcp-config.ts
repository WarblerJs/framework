import { validateMcp } from "./transport-validation";

/** Validates MCP transport configuration and throws on the first invalid value. */
export function validateMcpConfig(value: unknown): void {
  validateMcp(value);
}
