# Warbler PostgreSQL ORM (`database/warbler/pg`)

Migration-first PostgreSQL ORM for this project, powered by `@warbler/database`. **PostgreSQL
itself is the source of truth.** There are no hand-written model files — you evolve the schema
through typed migrations, then generate the client by introspecting the live database.

```
Migration files  →  warbler db:pg migration  →  PostgreSQL  →  warbler db:pg generate  →  App
```

```
database/warbler/pg/
  migrations/   you write these — <timestamp>_<kind>_<name>.ts
  generated/    compiler output — do not edit, gitignored
    schema.sql            read-only mirror of the live schema (not an input)
    metadata.json
    runtime/pg-client.ts  Bun SQL connection, built from src/config/database.config.ts
    client/<key>.ts       typed CRUD functions per introspected table
    client/index.ts       WlbPg barrel
    models/<Model>.ts     read-only PgTypes mirror of each table, for reference only
  seeds/        reserved for a future phase
```

## Configuration

`src/config/database.config.ts` (already present):

```ts
import { envBoolean, envNumber, envString } from "@warbler/config";

export const databaseConfig = {
  pg: {
    // Logs every executed query (including inside transactions) when true.
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
      // Optional: override automatic table -> model name singularization for irregular words.
      // modelNames: { people: "Person" },
    },
  },
} as const;
```

`warbler dev` and `warbler build` no longer touch the database at all — both migrating and
generating require a live connection, so (like Prisma, sqlc, and kysely-codegen) they stay
explicit steps you run yourself, not something the dev server silently depends on.

## Migrating

**Scaffold a new migration** — writes a timestamped file under `migrations/`:

```sh
warbler db:pg migration create:table:user
# database/warbler/pg/migrations/20260805143025_create_table_user.ts
```

Supported kinds: `create:table`, `alter:table`, `rename:table`, `drop:table`, `add:column`,
`alter:column`, `rename:column`, `drop:column`, `create:index`, `create:unique:index`,
`drop:index`, `create:enum`, `alter:enum`, `raw:custom`. Table-scaffold kinds pluralize the given
name into the table argument (`user` → `"users"`); column/index/enum-scaffold kinds leave clearly
marked placeholders since there's no reliable way to guess a table+column split from a free-form
name.

A migration exports typed `up`/`down` functions using the same `PgTypes`/`PgDefault`/`PgCheck`
builders as before:

```ts
// migrations/20260805143025_create_table_user.ts
import type { PgMigration } from "@warbler/database";
import { PgDefault, PgTypes } from "@warbler/database";

export const up: PgMigration = async (pgm) => {
  await pgm.createTable("users", {
    id: PgTypes.Uuid({ primaryKey: true, default: PgDefault.GenRandomUuid }),
    email: PgTypes.VarChar({ length: 255, nullable: false, unique: true }),
    createdAt: PgTypes.Timestamp({ default: PgDefault.Now, nullable: false }),
    updatedAt: PgTypes.Timestamp({ default: PgDefault.Now, nullable: false }),
  });
};

export const down: PgMigration = async (pgm) => {
  await pgm.dropTable("users");
};
```

```ts
// migrations/20260806090000_add_column_user_role.ts
import type { PgMigration } from "@warbler/database";
import { OnDeleteAction, PgTypes } from "@warbler/database";

export const up: PgMigration = async (pgm) => {
  await pgm.addColumns("users", {
    roleId: PgTypes.Uuid({
      nullable: false,
      references: { table: "roles", column: "id" }, // by name — the target may be a different migration file
      onDelete: OnDeleteAction.Cascade,
      index: true,
    }),
  });
};

export const down: PgMigration = async (pgm) => {
  await pgm.dropColumns("users", ["roleId"]);
};
```

The full `pgm` API: `createTable`, `dropTable`, `renameTable`, `addColumns`, `dropColumns`,
`alterColumn`, `renameColumn`, `createIndex`, `dropIndex`, `createEnum`, `dropEnum`, `alterEnum`,
`raw`. Every call executes immediately against the transaction that migration runs in.

**Run pending migrations**:

```sh
warbler db:pg migration
```

```
20260805143025_create_table_user (batch 1, 42ms)
20260806090000_add_column_user_role (batch 1, 11ms)
```

Each migration runs in its own transaction, in filename (timestamp) order. Already-executed
migrations are tracked by name + a content checksum in the `_wrbls_migrations` table (configurable
via `migrations.table`) and skipped; if a previously-run migration's file has since changed, the
run aborts before touching the database — migrations are immutable once executed, write a new one
instead of editing an old one.

**Roll back the latest applied migration**:

```sh
warbler db:pg rollback
```

```
20260806090000_add_column_user_role (batch 1, 9ms)
```

Rollback uses the database migration history as the source of truth, not filenames on disk. It
selects the newest applied migration, loads that exact local file, verifies the file still matches
the recorded checksum, runs its `down` function in a transaction, and removes the history row only
after `down` succeeds. If there is nothing applied, the command exits cleanly:

```
Nothing to rollback.
```

To roll back more than one migration, pass a positive integer step count:

```sh
warbler db:pg rollback --step=3
```

Multiple rollbacks run newest first, one transaction per migration. If fewer migrations exist than
requested, Warbler rolls back the available migrations and stops cleanly. If a rollback fails, the
current migration's transaction is rolled back and its history row remains applied; any earlier
rollback steps that already committed remain reverted. Missing migration files, changed checksums,
and missing/invalid `down` exports fail before modifying migration history.

After a rollback changes the live schema, refresh generated client files explicitly:

```sh
warbler db:pg generate
```

## Generating

Connects to the live database, introspects it via PostgreSQL's system catalogs, and writes
`schema.sql`/`metadata.json`/the generated client — no model files are read:

```sh
warbler db:pg generate
```

```
Compiled 2 table(s): roles, users
```

Table names are singularized into model/client names automatically (`users` → `User` /
`WlbPg.user`); for irregular words, add an entry to `migrations.modelNames` in the config above.
Generation rewrites the generated client/model snapshot from the current live schema and removes
stale generated files for tables that no longer exist.

## Using the generated client

```ts
import { WlbPg } from "../../database/warbler/pg/generated/client";

const user = await WlbPg.user.findUnique({ email: "ada@example.com" }); // exactly one key
const page = await WlbPg.user.findMany({ limit: 20, offset: 0 });
const created = await WlbPg.user.insert({ email: "ada@example.com" });
await WlbPg.user.update({ id: created.id }, { email: "ada2@example.com" });
await WlbPg.user.delete({ id: created.id });
const total = await WlbPg.user.count();
```

Each table gets `findUnique`, `findFirst`, `findMany`, `insert`, `update`, `delete`, `count` —
`findUnique`/`findFirst` (with a `where`)/`update`/`delete`/`count` (with a `where`) accept exactly
one column that's a primary key or unique in the live schema. Row/insert/update/where types are
inferred from the introspected table; there is nothing to hand-write.

The live connection lives in `generated/runtime/pg-client.ts` (built via the exported
`createPgConnection` helper). Import it directly for a raw query or transaction:

```ts
import { pg } from "../../database/warbler/pg/generated/runtime/pg-client";

await pg.begin(async (tx) => {
  await tx`update users set email = ${next} where id = ${id}`;
});
```

## Not yet implemented

Table partitioning (`create:partition`), triggers, views, generated/computed columns,
`insertMany`/`updateMany`/`deleteMany`/`upsert`/`exists`/`aggregate`/`paginate` client methods, and
multi-column `where` filters beyond a single unique key.
