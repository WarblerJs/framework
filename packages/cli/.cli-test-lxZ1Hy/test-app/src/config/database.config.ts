export const databaseConfig = {
  pg: {
    connection: {},
    migrations: {
      table: "_wrbls_migrations",
      seedTable: "_warbler_seeds",
      generated: "database/warbler/pg/generated",
      path: "database/warbler/pg/migrations",
      seeds: "database/warbler/pg/seeds",
      softDelete: true,
    },
  },
};
