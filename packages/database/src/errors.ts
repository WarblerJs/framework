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

/** Error thrown when a requested record is required but no row matched the query. */
export class DatabaseRecordNotFoundError extends DatabaseError {
  public constructor(public readonly modelName: string, operation: string) {
    super(`${modelName}.${operation} did not find a matching record.`, "DB3001");
    this.name = "DatabaseRecordNotFoundError";
  }
}

/** Error thrown when a generated client query receives an invalid query object. */
export class DatabaseQueryError extends DatabaseError {
  public constructor(public readonly modelName: string, detail: string) {
    super(`Invalid ${modelName} query: ${detail}`, "DB3002");
    this.name = "DatabaseQueryError";
  }
}

/** Error thrown when a generated transaction is misused or receives invalid options. */
export class DatabaseTransactionError extends DatabaseError {
  public constructor(
    public readonly reason: "invalid-options" | "completed-client" | "unsupported",
    detail: string,
    cause?: unknown,
  ) {
    super(`Invalid database transaction: ${detail}`, "DB3003", { cause });
    this.name = "DatabaseTransactionError";
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

/** Error thrown when migration history cannot be read or updated safely. */
export class MigrationHistoryError extends DatabaseError {
  public constructor(
    public readonly operation: "read" | "delete",
    detail: string,
    cause?: unknown,
  ) {
    super(`Failed to ${operation} migration history: ${detail}`, "DB2004", { cause });
    this.name = "MigrationHistoryError";
  }
}

/** Error thrown when a migration recorded in the database no longer exists locally. */
export class MigrationFileNotFoundError extends DatabaseError {
  public constructor(
    public readonly migrationName: string,
    public readonly path: string,
  ) {
    super(`Migration "${migrationName}" is recorded in history but ${path} was not found.`, "DB2005");
    this.name = "MigrationFileNotFoundError";
  }
}

/** Error thrown when a migration module does not satisfy the expected up/down contract. */
export class MigrationDefinitionError extends DatabaseError {
  public constructor(
    public readonly migrationName: string,
    detail: string,
    cause?: unknown,
  ) {
    super(`Migration "${migrationName}" is invalid: ${detail}`, "DB2006", { cause });
    this.name = "MigrationDefinitionError";
  }
}

/** Error thrown when a migration down operation fails during rollback. */
export class MigrationRollbackExecutionError extends DatabaseError {
  public constructor(public readonly migrationName: string, cause?: unknown) {
    super(`Rollback failed while executing "${migrationName}".`, "DB2007", { cause });
    this.name = "MigrationRollbackExecutionError";
  }
}

/** Error thrown when a rollback step count is invalid. */
export class MigrationRollbackStepError extends DatabaseError {
  public constructor(detail: string) {
    super(`Invalid rollback step: ${detail}`, "DB2008");
    this.name = "MigrationRollbackStepError";
  }
}

/** Error thrown when the PostgreSQL migration advisory lock cannot be acquired or released. */
export class MigrationLockError extends DatabaseError {
  public constructor(
    public readonly operation: string,
    public readonly phase: "acquire" | "release",
    cause?: unknown,
  ) {
    super(`Failed to ${phase} migration lock for ${operation}.`, "DB2009", { cause });
    this.name = "MigrationLockError";
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
