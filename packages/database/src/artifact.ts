import type { TableMetadata } from "./types/model.types";

export interface CompiledDatabaseArtifactInput {
  readonly tables: readonly TableMetadata[];
}

/** Immutable, deep-frozen description of every discovered table, returned by `compileDatabaseProject`. */
export interface CompiledDatabaseArtifact {
  readonly schemaVersion: 1;
  readonly tables: readonly TableMetadata[];
  readonly fingerprint: string;
}

const deepFreeze = <T>(value: T): T => {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
};

/** Deep-freeze factory for the compiled database artifact, mirroring `createCompiledViewArtifact`. */
export function createCompiledDatabaseArtifact(input: CompiledDatabaseArtifactInput): CompiledDatabaseArtifact {
  const tables = deepFreeze(
    [...input.tables].sort((left, right) => left.tableName.localeCompare(right.tableName, "en")),
  );
  return Object.freeze({
    schemaVersion: 1,
    tables,
    fingerprint: Bun.hash(JSON.stringify(tables)).toString(16),
  });
}
