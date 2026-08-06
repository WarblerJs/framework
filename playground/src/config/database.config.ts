import {
  envBoolean,
  envNumber,
  envString,
} from "@warbler/config";

export const databaseConfig = {
  pg: {
    log: envBoolean("DB_LOG_QUERIES", false),

    connection: {
      adapter: "postgres" as const,

      url: envString("DATABASE_URL", ""),

      hostname: envString("DB_HOST", "localhost"),
      port: envNumber("DB_PORT", 5432),
      database: envString("DB_DATABASE", "warbler_playground"),
      username: envString("DB_USERNAME", "warbler"),
      password: envString("DB_PASSWORD", "warbler"),

      ssl: envBoolean("DB_SSL", false),

      max: envNumber("DB_POOL_MAX", 10),
      idleTimeout: envNumber("DB_IDLE_TIMEOUT", 30),
      connectionTimeout: envNumber("DB_CONNECTION_TIMEOUT", 10),
    },

    migrations: {
      table: "_wrbls_migrations",
      generated: "database/warbler/pg/generated",
      path: "database/warbler/pg/migrations",
      seeds: "database/warbler/pg/seeds",
    },
  },
} as const;
