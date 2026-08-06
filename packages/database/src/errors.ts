/** Base error for deterministic Warbler database failures. */
export class DatabaseError extends Error {
  public constructor(
    message: string,
    public readonly code: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "DatabaseError";
  }
}

/** Error thrown when a column set (a migration's `createTable`/`addColumns` argument) cannot be resolved. */
export class DatabaseCompileError extends DatabaseError {
  public constructor(
    public readonly label: string,
    public readonly detail: string,
    cause?: unknown,
  ) {
    super(`Failed to resolve columns for "${label}": ${detail}`, "DB1001", { cause });
    this.name = "DatabaseCompileError";
  }
}

/** Error thrown when `database.config.ts` is missing required configuration. */
export class DatabaseConfigError extends DatabaseError {
  public constructor(detail: string, cause?: unknown) {
    super(`Invalid database configuration: ${detail}`, "DB1003", { cause });
    this.name = "DatabaseConfigError";
  }
}

/** Error thrown when a migration kind/name argument cannot be scaffolded. */
export class MigrationScaffoldError extends DatabaseError {
  public constructor(detail: string) {
    super(`Failed to scaffold migration: ${detail}`, "DB2001");
    this.name = "MigrationScaffoldError";
  }
}

/** Error thrown when a previously-executed migration's file contents no longer match its recorded checksum. */
export class MigrationChecksumError extends DatabaseError {
  public constructor(public readonly migrationName: string) {
    super(
      `Migration "${migrationName}" has already run but its file contents have changed since. ` +
        "Migrations are immutable once executed — create a new migration instead of editing this one.",
      "DB2002",
    );
    this.name = "MigrationChecksumError";
  }
}

/** Error thrown when a seed file doesn't export a valid `seed` function, or a seed name is invalid. */
export class SeedError extends DatabaseError {
  public constructor(public readonly seedName: string, detail: string) {
    super(`Seed "${seedName}" is invalid: ${detail}`, "DB2003");
    this.name = "SeedError";
  }
}

/** Checks whether a failure belongs to the Warbler database package. */
export const isDatabaseError = (value: unknown): value is DatabaseError => value instanceof DatabaseError;
