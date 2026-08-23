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
  DatabaseTransactionError,
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
  executeAggregate,
  executeCount,
  executeExists,
  executeExplainAggregate,
  executeExplainCount,
  executeExplainExists,
  executeExplainFindFirst,
  executeExplainFindMany,
  executeExplainFindUnique,
  executeExplainGroupBy,
  executeFindFirst,
  executeFindFirstOrThrow,
  executeFindMany,
  executeFindUnique,
  executeFindUniqueOrThrow,
  executeGroupBy,
} from "./runtime/read-query";
export type {
  AggregateQueryArgs,
  ComparableFilter,
  CountQueryArgs,
  EqualityFilter,
  ExistsQueryArgs,
  GroupByQueryArgs,
  PgExplainOptions,
  PgExplainResult,
  PgRowLock,
  PgRowLockMode,
  PgRowLockWait,
  ReadQueryArgs,
  RuntimeColumn,
  RuntimeColumnAggregateCapabilities,
  RuntimeModel,
  RuntimeReadSchema,
  RuntimeRelation,
  RuntimeSoftDelete,
  SortDirection,
  StringFilter,
} from "./runtime/read-query";
export {
  executeCreate,
  executeCreateMany,
  executeCreateManyAndReturn,
  executeDelete,
  executeDeleteMany,
  executeForceDelete,
  executeForceDeleteMany,
  executeRestore,
  executeRestoreMany,
  executeSoftDelete,
  executeSoftDeleteMany,
  executeUpdate,
  executeUpdateMany,
  executeUpdateManyAndReturn,
  executeUpsert,
} from "./runtime/write-query";
export type { MutationCountResult, WriteQueryArgs } from "./runtime/write-query";
export { withQueryLogging } from "./runtime/query-logger";
export type { QueryLogEntry, QueryLogger } from "./runtime/query-logger";
export { executeTransaction } from "./runtime/transaction-query";
export type { TransactionIsolationLevel, TransactionOptions } from "./runtime/transaction-query";

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

export { generateClientBarrelSource, generateClientFactorySource, generateClientSource } from "./generator/generate-client";
export { generateRuntimeClientSource, generateRuntimeFactorySource } from "./generator/generate-runtime";
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

export { DEFAULT_SEED_TABLE, discoverSeedFiles, ensureSeedsTable, runSeeds } from "./seeds/run-seeds";
export type { ExecutedSeed, RunSeedsOptions, RunSeedsResult, SeedFile } from "./seeds/run-seeds";
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
