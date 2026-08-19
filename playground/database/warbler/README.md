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

const user = await WlbPg.user.findUnique({
  where: { email: "ada@example.com" }, // exactly one primary-key or unique field
});

const active = await WlbPg.user.findFirst({
  where: {
    email: { endsWith: "@example.com" },
    isActive: true,
  },
  orderBy: { createdAt: "desc" },
});

const page = await WlbPg.user.findMany({
  where: { isActive: true },
  orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  take: 20,
  skip: 0,
});

const created = await WlbPg.user.create({
  data: { email: "ada@example.com", passwordHash: hash, isActive: true },
});

await WlbPg.user.update({
  where: { id: created.id },
  data: { email: "ada2@example.com" },
});

await WlbPg.user.delete({
  where: { id: created.id },
});

const total = await WlbPg.user.count();

const activeUsers = await WlbPg.user.count({
  where: { isActive: true },
});

const selectedCounts = await WlbPg.user.count({
  select: { _all: true, email: true },
});

const hasUser = await WlbPg.user.exists({
  where: { email: "ada@example.com" },
});
```

Each table gets `findUnique`, `findUniqueOrThrow`, `findFirst`, `findFirstOrThrow`, `findMany`,
`count`, `exists`, `aggregate`, `groupBy`, `create`, `createMany`, `createManyAndReturn`, `insert`
(compatibility alias for `create({ data })`), `update`, `updateMany`, `updateManyAndReturn`,
`upsert`, `delete`, and `deleteMany`. `WlbPg` also exposes `transaction` and the native Bun SQL
escape hatch `db`. Read and write methods use query objects:

```ts
await WlbPg.userSession.findFirst({
  where: {
    sessionHash,
    revokedAt: null,
    expiresAt: { gt: new Date() },
  },
  orderBy: { createdAt: "desc" },
});
```

The old ambiguous `findFirst({ email })` / `findUnique({ id })` style is replaced by
`findFirst({ where: { email } })` and `findUnique({ where: { id } })`.

`findUnique` accepts only a single primary-key or unique scalar selector from the live schema.
`findUniqueOrThrow` and `findFirstOrThrow` return a non-null row or throw a Warbler database
record-not-found error.

`where` supports direct equality, `null`/`not: null`, `equals`, `not`, `gt`, `gte`, `lt`, `lte`,
`in`, `notIn`, and string-only `contains`, `startsWith`, and `endsWith`. Logical filters are
available through `AND`, `OR`, and `NOT`. Explicit `undefined` in filters is rejected so a missing
value cannot silently broaden a query.

Aggregation methods compile directly to PostgreSQL and reuse the same `where` filter compiler:

```ts
const totals = await WlbPg.userSession.aggregate({
  where: { revokedAt: null },
  _count: true,
  _min: { createdAt: true },
  _max: { lastUsedAt: true },
});

const grouped = await WlbPg.userSession.groupBy({
  by: ["userId"],
  where: { revokedAt: null },
  _count: { id: true },
  orderBy: { _count: { id: "desc" } },
  take: 20,
});
```

Use `select` to fetch only requested scalar fields:

```ts
const event = await WlbPg.eventRegistry.findFirst({
  where: { identifier: code, expiresAt: { gt: new Date() } },
  select: { id: true },
});
```

Use `include` or nested relation `select` for foreign-key relations discovered during
`warbler db:pg generate`:

```ts
const user = await WlbPg.user.findUnique({
  where: { id: userId },
  include: {
    sessions: {
      where: { revokedAt: null },
      orderBy: { createdAt: "desc" },
      take: 10,
    },
  },
});
```

Relation filters compile to PostgreSQL relation predicates such as `EXISTS`:

```ts
await WlbPg.user.findFirst({
  where: {
    sessions: {
      some: { revokedAt: null },
    },
  },
});
```

Nested to-many reads are compiled into PostgreSQL subqueries/JSON aggregation rather than N+1
application queries. Runtime reads do not introspect `information_schema` or `pg_catalog`; relation
metadata is generated once from PostgreSQL foreign keys.

Read pagination uses `take`, `skip`, and keyset `cursor` boundaries on `findMany`. Invalid
`take`/`skip` values such as `NaN`, fractions, negative numbers, and unsafe integers are rejected.
Plain offset pagination still works with `skip` and `take`:

```ts
const page = await WlbPg.product.findMany({
  orderBy: { id: "asc" },
  skip: 100,
  take: 50,
});
```

Cursor pagination is strictly after the supplied boundary. For ascending fields Warbler emits `>`,
and for descending fields it emits `<`:

```ts
const next = await WlbPg.product.findMany({
  orderBy: { id: "asc" },
  cursor: { id: lastProductId },
  take: 50,
});
```

For non-unique ordering, provide an explicit stable tie-breaker such as the primary key and include
every ordered field in the cursor:

```ts
const nextByPrice = await WlbPg.product.findMany({
  where: {
    isActive: true,
    price: { gte: "100" },
  },
  orderBy: [
    { price: "asc" },
    { id: "asc" },
  ],
  cursor: {
    price: last.price,
    id: last.id,
  },
  take: 50,
});
```

Compound cursors use a lexicographic keyset predicate, so duplicate sort values are not skipped or
repeated. Mixed directions are supported per field:

```ts
await WlbPg.product.findMany({
  orderBy: [
    { price: "desc" },
    { createdAt: "asc" },
    { id: "asc" },
  ],
  cursor: {
    price: last.price,
    createdAt: last.createdAt,
    id: last.id,
  },
  take: 50,
});
```

Cursor queries must include a primary-key or unique field in `orderBy`; Warbler does not add hidden
tie-breakers or perform cursor-row lookup queries. Cursor fields are parameterized values, and SQL
identifiers come from generated metadata. Nullable cursor-order fields are rejected for now because
PostgreSQL `NULLS FIRST`/`NULLS LAST` semantics need an explicit public contract. `cursor` with
`skip > 0` is rejected; use one strategy at a time. Backward pagination is not part of the current
API. Timestamp cursor ordering uses millisecond precision to match the generated JavaScript `Date`
values. If rows are inserted, deleted, or updated between page requests, later pages can reflect
those database changes. For large keyset scans, add matching indexes in migrations, for example
`products(price, id)`.

Row/insert/update/where/select/include types are inferred from the introspected table; there is
nothing to hand-write.

Mutation methods use PostgreSQL-native writes with parameterized values and `RETURNING`:

```ts
await WlbPg.userSession.createMany({
  data: [
    { userId, sessionHash: firstHash, expiresAt },
    { userId, sessionHash: secondHash, expiresAt },
  ],
  skipDuplicates: true,
});

const revoked = await WlbPg.userSession.updateMany({
  where: { userId, revokedAt: null },
  data: { revokedAt: new Date() },
});

const latest = await WlbPg.userSession.updateManyAndReturn({
  where: { userId, revokedAt: null },
  data: { lastUsedAt: new Date() },
  select: { id: true, lastUsedAt: true },
});

const user = await WlbPg.user.upsert({
  where: { email: "ada@example.com" },
  create: { email: "ada@example.com", passwordHash: hash, isActive: true },
  update: { isActive: true },
});
```

`updateMany` and `deleteMany` require a non-empty `where` object. Explicit `undefined` in mutation
data is rejected, unknown fields fail fast, `createMany` is batched into one multi-row insert, and
numeric columns support atomic `increment`, `decrement`, `multiply`, and `divide` operators.

Use `WlbPg.db` for native Bun SQL when PostgreSQL-specific SQL is clearer than adding ORM surface
area:

```ts
type UserSummary = { id: string; email: string };

const users = await WlbPg.db<UserSummary[]>`
  SELECT id, email
  FROM users
  WHERE is_active = ${true}
  ORDER BY created_at DESC
`;

const table = WlbPg.db("users");
const rows = await WlbPg.db`
  SELECT *
  FROM ${table}
`;

const filter = WlbPg.db`
  AND created_at >= ${from}
`;

const active = await WlbPg.db`
  SELECT *
  FROM users
  WHERE is_active = ${true}
  ${filter}
`.values();
```

`WlbPg.db` is the same configured Bun `SQL` instance used by generated ORM delegates, so Bun's
native tagged-template parameter binding, fragments, dynamic identifier helper, object/bulk helper,
`array`, `values`, `raw`, `execute`, `cancel`, `file`, and `unsafe` behavior are preserved. Bound
values such as `${email}` stay parameterized. Do not build SQL by string-concatenating user input.
`WlbPg.db.unsafe(...)` is exposed because Bun exposes it; it bypasses normal tagged-template safety
and must only receive trusted SQL strings.

Good uses for native SQL include CTEs, recursive CTEs, window functions, `FOR UPDATE`, complex
aggregates, PostgreSQL-specific operators, advanced joins, reporting, analytics, hand-optimized
queries, and special `RETURNING` queries.

Transactions are callback-based and use Bun SQL's transaction connection for every `tx.*` query:

```ts
const result = await WlbPg.transaction(async (tx) => {
  const user = await tx.user.create({
    data: { email: "ada@example.com", passwordHash: hash, isActive: true },
  });

  const locked = await tx.db`
    SELECT id
    FROM users
    WHERE id = ${user.id}
    FOR UPDATE
  `;

  const session = await tx.userSession.create({
    data: { userId: user.id, sessionHash, expiresAt },
  });

  return { user, locked, session };
}, {
  isolationLevel: "serializable",
  readOnly: false,
  timeout: 5_000,
});
```

The callback result type is preserved. A transaction client exposes `tx.db` plus model delegates,
but not `tx.transaction`, so nested transactions are not part of the typed API. If a transaction
client escapes its callback and is used later, Warbler throws a database transaction error instead
of routing the query through the normal pool. `timeout` is implemented with transaction-local
PostgreSQL `set_config('statement_timeout', ..., true)`, and `isolationLevel`/`readOnly` are
translated from trusted typed values into Bun/PostgreSQL transaction options.

Keep transactional operations sequential unless you have verified Bun/PostgreSQL behavior for your
exact workload. A single transaction uses one connection, so `Promise.all` inside a transaction is
not a throughput shortcut.

The live connection lives in `generated/runtime/pg-client.ts` (built via the exported
`createPgConnection` helper). It is the same object exposed as `WlbPg.db`. Import it directly only
when you truly need lower-level lifecycle access:

```ts
import { pg } from "../../database/warbler/pg/generated/runtime/pg-client";

await pg.begin(async (tx) => {
  await tx`update users set email = ${next} where id = ${id}`;
});
```

## Not yet implemented

Table partitioning (`create:partition`), triggers, views, generated/computed columns,
nested relation writes, `paginate` client methods, and multi-column unique selectors.
