export const ValidatorErrorCode = Object.freeze({
  INVALID_DEFINITION: "VALIDATOR1001_INVALID_DEFINITION",
  INVALID_RULES: "VALIDATOR1002_INVALID_RULES",
  SCHEMA_COMPILATION_FAILED: "VALIDATOR1003_SCHEMA_COMPILATION_FAILED",
  VALIDATION_FAILED: "VALIDATOR1004_VALIDATION_FAILED",
  INVALID_MESSAGE_DESCRIPTOR: "VALIDATOR1005_INVALID_MESSAGE_DESCRIPTOR",
  INVALID_KEY_MAPPING: "VALIDATOR1006_INVALID_KEY_MAPPING",
  DUPLICATE_MAPPED_KEY: "VALIDATOR1007_DUPLICATE_MAPPED_KEY",
  UNSAFE_MAPPED_KEY: "VALIDATOR1008_UNSAFE_MAPPED_KEY",
  ASYNC_SCHEMA_MISMATCH: "VALIDATOR1009_ASYNC_SCHEMA_MISMATCH",
  TRANSPORT_INPUT_INVALID: "VALIDATOR1010_TRANSPORT_INPUT_INVALID",
} as const);
export type ValidatorErrorCode = typeof ValidatorErrorCode[keyof typeof ValidatorErrorCode];
export class ValidatorError extends Error {
  public readonly code: ValidatorErrorCode;
  public constructor(code: ValidatorErrorCode, message: string, options?: ErrorOptions) {
    super(`${code}: ${message}`, options); this.name = "ValidatorError"; this.code = code;
  }
}
