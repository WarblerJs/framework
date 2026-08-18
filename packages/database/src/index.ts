export { PgTypes } from "./columns/pg-types";
export { PgDefault, type PgDefaultTypes } from "./columns/pg-default";
export { PgCheck } from "./columns/pg-check";
export { OnDeleteAction, type OnDeleteType } from "./columns/on-delete.types";
export { OnUpdateAction, type OnUpdateType } from "./columns/on-update.types";
export { resolveColumns } from "./columns/resolve-columns";

export {
  DatabaseCompileError,
  DatabaseConfigError,
  DatabaseError,
  DatabaseQueryError,
  DatabaseRecordNotFoundError,
  MigrationDefinitionError,
  MigrationFileNotFoundError,
  MigrationChecksumError,
  MigrationHistoryError,
  MigrationLockError,
  MigrationRollbackExecutionError,
  MigrationRollbackStepError,
  MigrationScaffoldError,
  SeedError,
  isDatabaseError,
} from "./errors";

export { createCompiledDatabaseArtifact } from "./artifact";
export type { CompiledDatabaseArtifact, CompiledDatabaseArtifactInput } from "./artifact";

export { createPgConnection } from "./runtime/create-connection";
export {
  executeCount,
  executeFindFirst,
  executeFindFirstOrThrow,
  executeFindMany,
  executeFindUnique,
  executeFindUniqueOrThrow,
} from "./runtime/read-query";
export type {
  ComparableFilter,
  CountQueryArgs,
  EqualityFilter,
  ReadQueryArgs,
  RuntimeColumn,
  RuntimeModel,
  RuntimeReadSchema,
  RuntimeRelation,
  SortDirection,
  StringFilter,
} from "./runtime/read-query";
export {
  executeCreate,
  executeCreateMany,
  executeCreateManyAndReturn,
  executeDelete,
  executeDeleteMany,
  executeUpdate,
  executeUpdateMany,
  executeUpdateManyAndReturn,
  executeUpsert,
} from "./runtime/write-query";
export type { MutationCountResult, WriteQueryArgs } from "./runtime/write-query";
export { withQueryLogging } from "./runtime/query-logger";
export type { QueryLogEntry, QueryLogger } from "./runtime/query-logger";

export { introspectDatabase } from "./introspection/introspect-database";
export type { IntrospectDatabaseOptions } from "./introspection/introspect-database";
export { mapPgType } from "./introspection/map-pg-type";
export type { ColumnTypeInfo, MappedPgType } from "./introspection/map-pg-type";
export { generateFromDatabase } from "./introspection/generate-from-database";
export type { DatabaseGenerationResult, GenerateFromDatabaseOptions } from "./introspection/generate-from-database";

export { generateSchemaSql } from "./schema/generate-schema-sql";
export {
  renderCheckConstraint,
  renderColumnDefinition,
  renderCreateEnumStatement,
  renderCreateIndexStatement,
  renderDefault,
  renderDropEnumStatement,
  renderDropIndexStatement,
  renderForeignKeyConstraint,
} from "./schema/ddl-fragments";
export type { ColumnDefinitionInput } from "./schema/ddl-fragments";

export { generateClientBarrelSource, generateClientSource } from "./generator/generate-client";
export { generateRuntimeClientSource } from "./generator/generate-runtime";
export { generateModelMirrorSource } from "./generator/generate-model-mirror";

export {
  deriveClientKey,
  deriveColumnName,
  deriveTableName,
  columnNameToFieldName,
  tableNameToClientKey,
  tableNameToModelName,
} from "./naming";

export { createPgMigrationContext } from "./migrations/create-pg-migration-context";
export { runMigrations } from "./migrations/run-migrations";
export type { ExecutedMigration, MigrationRunResult, RunMigrationsOptions } from "./migrations/run-migrations";
export { rollbackMigrations } from "./migrations/rollback-migrations";
export type { MigrationRollbackResult, RolledBackMigration, RollbackMigrationsOptions } from "./migrations/rollback-migrations";
export { scaffoldMigration } from "./migrations/scaffold-migration";
export type { ScaffoldedMigration } from "./migrations/scaffold-migration";
export { resetDatabase } from "./migrations/reset-database";

export { runSeeds } from "./seeds/run-seeds";
export type { RunSeedsOptions, RunSeedsResult } from "./seeds/run-seeds";
export { scaffoldSeed } from "./seeds/scaffold-seed";
export type { ScaffoldedSeed } from "./seeds/scaffold-seed";
export type { PgSeed } from "./seeds/types";

export type {
  AlterColumnChanges,
  AlterEnumChanges,
  CreateIndexOptions,
  CreateTableOptions,
  DropOptions,
  DropTableOptions,
  PgMigration,
  PgMigrationContext,
} from "./migrations/types";

export type {
  ColumnBuilder,
  ColumnBuilderFactory,
  ColumnCheckExpression,
  ColumnReference,
  ColumnValue,
  CommonColumnOptions,
  PgScalarType,
} from "./types/column.types";

export type {
  CheckConstraintMetadata,
  ColumnMetadata,
  EnumTypeMetadata,
  ForeignKeyMetadata,
  IndexMetadata,
  NormalizedColumn,
  RawSqlDefault,
  TableMetadata,
} from "./types/model.types";

export type {
  DatabaseProjectConfig,
  PgConnectionConfig,
  PgMigrationsConfig,
} from "./types/config.types";
