/** Identifies a configuration discovery, loading, parsing, or validation failure. */
export class ConfigError extends Error {
  /** Creates a configuration error for a precise configuration path. */
  public constructor(
    message: string,
    public readonly path?: string,
    options?: ErrorOptions,
  ) {
    super(path === undefined ? message : `${path}: ${message}`, options);
    this.name = "ConfigError";
  }
}
