/** Base error for dependency-injection failures. */
export class InjectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InjectionError";
  }
}

/** Raised when inject() is called without an active injection context. */
export class MissingInjectionContextError extends InjectionError {
  constructor() {
    super("inject() must be called inside an active Warbler injection context.");
    this.name = "MissingInjectionContextError";
  }
}

/** Raised when a provider token cannot be resolved. */
export class ProviderNotFoundError extends InjectionError {
  constructor(tokenName: string) {
    super(`Provider not found: ${tokenName}`);
    this.name = "ProviderNotFoundError";
  }
}

/** Raised when the provider graph contains a cycle. */
export class CircularDependencyError extends InjectionError {
  constructor(path: readonly string[]) {
    super(`Circular dependency detected: ${path.join(" -> ")}`);
    this.name = "CircularDependencyError";
  }
}
