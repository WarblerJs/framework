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

/** Raised when a provider token is registered twice in one scope. */
export class DuplicateProviderError extends InjectionError {
  constructor(tokenName: string) {
    super(`Duplicate provider: ${tokenName}`);
    this.name = "DuplicateProviderError";
  }
}

/** Raised when compiled dependencies cross an isolated Graph boundary. */
export class ProviderScopeError extends InjectionError {
  constructor(providerName: string, ownerGraph: string, consumerGraph: string) {
    super(
      `Provider "${providerName}" is scoped to Graph "${ownerGraph}" and cannot be injected into "${consumerGraph}". ` +
      "Declare provide: ProviderScope.ROOT if the provider should be globally available.",
    );
    this.name = "ProviderScopeError";
  }
}

/** Raised when the provider graph contains a cycle. */
export class CircularDependencyError extends InjectionError {
  constructor(path: readonly string[]) {
    super(`Circular dependency detected: ${path.join(" -> ")}`);
    this.name = "CircularDependencyError";
  }
}
