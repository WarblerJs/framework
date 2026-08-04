/** Base class for typed Runtime failures. */
export class RuntimeError extends Error {
  /** Creates a typed Runtime error without exposing implementation details. */
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}
/** Raised for invalid Runtime lifecycle transitions. */
export class InvalidRuntimeStateError extends RuntimeError {}
/** Raised when generated artifacts are malformed or unavailable. */
export class GeneratedArtifactError extends RuntimeError {}
/** Raised when a generated provider cannot be resolved. */
export class RuntimeProviderNotFoundError extends RuntimeError {}
/** Raised when generated provider construction fails. */
export class ProviderResolutionError extends RuntimeError {}
/** Raised when an enabled transport fails during startup or shutdown. */
export class RuntimeTransportError extends RuntimeError {}
/** Raised when a disabled transport is requested. */
export class TransportDisabledError extends RuntimeTransportError {}
/** Raised when a transport is started more than once. */
export class TransportAlreadyRunningError extends RuntimeTransportError {}
/** Raised when Runtime or transport configuration cannot load. */
export class RuntimeConfigurationError extends RuntimeError {}
/** Raised when application bootstrap fails. */
export class RuntimeBootstrapError extends RuntimeError {}
/** Raised when graceful shutdown fails. */
export class RuntimeShutdownError extends RuntimeError {}
