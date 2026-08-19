/** Mirrors the connection options accepted by Bun's `SQL` client for the `postgres` adapter. */
export interface PgConnectionConfig {
  readonly adapter?: "postgres";
  readonly url?: string;
  readonly hostname?: string;
  readonly port?: number;
  readonly database?: string;
  readonly username?: string;
  readonly password?: string;
  readonly ssl?: boolean;
  readonly max?: number;
  readonly idleTimeout?: number;
  readonly connectionTimeout?: number;
}

/** Migration table name, project-relative directories, and naming overrides. */
export interface PgMigrationsConfig {
  readonly table: string;
  readonly seedTable?: string;
  readonly generated: string;
  readonly path: string;
  readonly seeds: string;
  /** Overrides automatic singularization for irregular table names, e.g. `{ people: "Person" }`. */
  readonly modelNames?: Readonly<Record<string, string>>;
}

/** The shape `src/config/database.config.ts` must export under its `pg` key. */
export interface DatabaseProjectConfig {
  readonly connection: PgConnectionConfig;
  readonly migrations: PgMigrationsConfig;
  /** When `true`, every SQL query executed through this connection (including inside transactions) is logged. @default false */
  readonly log?: boolean;
}
