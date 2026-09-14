# Warbler

[![CI](https://github.com/WarblerJs/framework/actions/workflows/ci.yml/badge.svg)](https://github.com/WarblerJs/framework/actions/workflows/ci.yml)
[![npm CLI](https://img.shields.io/npm/v/%40warblerjs%2Fcli?label=%40warblerjs%2Fcli)](https://www.npmjs.com/package/@warblerjs/cli)
[![npm framework](https://img.shields.io/npm/v/%40warblerjs%2Fframework?label=%40warblerjs%2Fframework)](https://www.npmjs.com/package/@warblerjs/framework)
[![Release](https://img.shields.io/github/v/release/WarblerJs/framework?label=release)](https://github.com/WarblerJs/framework/releases)

Compile-first TypeScript backend framework for declarative, transporter-oriented applications.

Warbler lets you describe application boundaries as Graphs, then compiles routes, handlers,
validators, providers, request context types, and runtime tables before the application starts.
The current runtime target is Bun, while public application code is shaped around Web Standard
objects such as `Request`, `Response`, `Headers`, `URL`, streams, `AbortSignal`, and Web Crypto.

- Current release: `v0.6.0`
- Project status: active pre-1.0 framework; APIs are usable but still evolving
- Runtime: Bun `>=1.3.0`
- TypeScript: `^5.9.2` in generated projects
- PostgreSQL: required only for `warbler db:pg ...` commands and the generated PostgreSQL client
- License: Apache License 2.0

## Why Warbler?

Warbler is built around a compile-first pipeline. Application source stays declarative; framework
tooling analyzes it, emits `.warbler/generated/*`, and the runtime executes those generated tables.

| Area | What Warbler does in v0.6.0 |
| --- | --- |
| Architecture | `createApp()` points at Graph classes or graph globs such as `src/graphs/**/*.graph.ts`. |
| HTTP | `defineHttpGraph()` declares route tables with typed route keys such as `"GET /users/:id"`. |
| Validation | `defineValidator()` and `v` validate body, params, query, headers, cookies, socket messages, and metadata. |
| DI | Providers are discovered at compile time; runtime resolution does not depend on reflection metadata. |
| Transports | `Transport.HTTP` and `Transport.WEBSOCKET` have runtime launchers today. TCP, UDP, MCP, and WebRTC are recognized in config but do not ship production launchers in this repo yet. |
| Security | HTTP body limits, header/query/cookie/path limits, host checks, CSRF policy, static file boundaries, and response security headers are configured up front. |
| Production | `warbler build` emits a Bun production entry under `dist/server.js` plus a deterministic build manifest. |
| Hot path | v0.6.0 adds route response-kind metadata, including `response: "text"`, so security headers can be specialized for API/text/view/static responses. |

Generated files are implementation artifacts. Read them when debugging, but do not hand-edit
`.warbler/generated` or `database/warbler/pg/generated`.

## Requirements

Install Bun first, then install the CLI:

```bash
bun install -g @warblerjs/cli
```

Generated projects declare:

```json
{
  "engines": {
    "bun": ">=1.3.0"
  },
  "devDependencies": {
    "typescript": "^5.9.2"
  }
}
```

PostgreSQL is needed when you use the database workflow. The repository CI runs PostgreSQL 17,
and the connection layer uses Bun's built-in `SQL` client with the `postgres` adapter.

## Installation and First Project

Create a project:

```bash
warbler new my-app
cd my-app
bun install
bun run dev
```

The generated `package.json` includes these scripts:

```bash
bun run dev
bun run build
bun run start
bun run doctor
bun run inspect
bun run test
bun run typecheck
```

The starter creates this shape:

```text
my-app/
  database/warbler/pg/
  public/
  resources/css/app.css
  resources/i18n/en/messages.json
  resources/js/app.ts
  resources/views/
  src/config/
    crypto.config.ts
    database.config.ts
    i18n.config.ts
    logging.config.ts
    mail.config.ts
    profiling.config.ts
    runtime.config.ts
    view.ts
    transports/
      http.config.ts
      ws.config.ts
      tcp.config.ts
      udp.config.ts
      mcp.config.ts
      webrtc.config.ts
  src/graphs/home/home.graph.ts
  src/graphs/home/presentation/http/handlers/home.handlers.ts
  src/main.ts
  storage/logs/
  tests/app.test.ts
  tsconfig.json
```

`src/main.ts` is the application entry:

```ts
import { createApp, Transport } from "@warblerjs/framework";

export default createApp({
  transports: [
    Transport.HTTP,
  ],

  graphs: "src/graphs/**/*.graph.ts",
});
```

## Choosing an Architecture

Graphs are feature boundaries. The generator supports four verified presets:

```bash
warbler make:graph users
warbler make:graph users --architecture hexagonal
warbler make:graph users -a clean
warbler make:graph users -a mvc
warbler make:graph chat --transport socket
warbler make:graph realtime -a hexagonal -t http,socket
```

The default architecture is `minimal`; the default transport is `http`.

- `minimal`: a graph file and presentation handlers.
- `hexagonal`: presentation, application use cases/DTOs, domain entities/value objects/errors/ports, and infrastructure adapters/persistence.
- `clean`: presentation/infrastructure around application/domain layers.
- `mvc`: handlers as controllers, plus `models` and optional `views`.

## HTTP Graphs, Routes, and Handlers

Prefer declarative Graphs over decorators for new code:

```ts
import { defineHandler, defineHttpGraph, JsonRes } from "@warblerjs/framework";

export const index = defineHandler({
  run: () => JsonRes({ message: "users" }),
});

export default defineHttpGraph({
  prefix: "/api",
  middlewares: [],
  providers: [],
  routes: {
    "GET /users": {
      name: "users.index",
      handler: index,
    },
  },
});
```

Inline routes can use `defineHttpRoute()` when the route itself owns validation and you want
TypeScript to infer the validated request shape from a sibling `validator` property:

```ts
import {
  JsonRes,
  defineHttpGraph,
  defineHttpRoute,
  defineValidator,
  v,
} from "@warblerjs/framework";

const showUser = defineValidator({
  paramRules: {
    id: v.uuid("validators.invalid_id"),
  },
  queryRules: {
    include: v.string().in(["profile", "sessions"] as const).optional(),
  },
});

export default defineHttpGraph({
  prefix: "/api",
  routes: {
    "GET /users/:id": defineHttpRoute({
      name: "users.show",
      validator: showUser,
      run: (request) => JsonRes({
        id: request.params.id,
        include: request.query.include,
      }),
    }),
  },
});
```

Route keys are typed as `${METHOD} /path`; supported HTTP methods are `GET`, `POST`, `PUT`,
`PATCH`, `DELETE`, `OPTIONS`, and `HEAD`.

## Validation

Validators can read independent request sources:

```ts
import { defineValidator, v } from "@warblerjs/framework";

export const createUser = defineValidator({
  csrf: true,
  paramRules: {
    accountId: v.uuid("validators.invalid_account"),
  },
  queryRules: {
    page: v.number("validators.invalid_page").int().gte(1).optional(),
  },
  headerRules: {
    "x-tenant": v.string("validators.invalid_tenant").min(2),
  },
  cookieRules: {
    session: v.string("validators.invalid_session").optional(),
  },
  bodyRules: {
    email: v.email("validators.invalid_email"),
    name: v.string("validators.invalid_name").trim().min(2),
    tags: v.array(v.string()).optional(),
  },
});
```

A handler can then use `AppRequest<typeof createUser>`:

```ts
import {
  JsonRes,
  defineHandler,
  type AppRequest,
} from "@warblerjs/framework";
import { createUser } from "./users.validators";

export const store = defineHandler({
  validator: createUser,
  run: (request: AppRequest<typeof createUser>) => JsonRes({
    accountId: request.params.accountId,
    tenant: request.headers["x-tenant"],
    email: request.body.email,
  }, { status: 201 }),
});
```

Available field builders are `v.string()`, `v.number()`, `v.boolean()`, `v.date()`, `v.email()`,
`v.price()`, `v.file()`, `v.object()`, `v.array()`, `v.uuid()`, `v.ulid()`, `v.cuid()`,
`v.nanoid()`, and `v.serial()`. Common rules include `optional()`, `nullable()`, `min()`,
`max()`, `length()`, `regex()`, `digits()`, `trim()`, `int()`, `positive()`, `gte()`, `lte()`,
`between()`, `in()`, `notIn()`, `equal()`, `notEqual()`, `requiredWith()`, `requiredWhen()`,
`rejectIf()`, `mapV()`, and `mapK()`.

`bodyRule` validates a root body value such as an array. `bodyRules` validates object fields.
`rules` and `pathRules` still exist as deprecated aliases; prefer `bodyRules` and `paramRules`.

## Responses

Warbler response helpers return native `Response` objects:

```ts
import {
  EmptyRes,
  HtmlRes,
  JsonRes,
  RedirectRes,
  TextRes,
} from "@warblerjs/framework";

JsonRes({ ok: true });
JsonRes({ created: true }, { status: 201 });
TextRes("ok");
HtmlRes("<h1>Warbler</h1>");
RedirectRes("/login", 303);
EmptyRes();
```

Files and streams use Web platform types:

```ts
import { DownloadRes, FileRes, SseRes } from "@warblerjs/framework";

const blob = new Blob(["hello"], { type: "text/plain" });

FileRes(blob);
DownloadRes(blob, { filename: "hello.txt" });

async function* events() {
  yield { event: "ready", data: { ok: true } };
}

SseRes(events());
```

For route metadata, v0.6.0 supports `response: "static" | "view" | "json" | "html" | "text"`.
Use `response: "text"` for simple text endpoints when you want the compiler/runtime to select
the lighter text response path:

```ts
import { TextRes, defineHandler, defineHttpGraph } from "@warblerjs/framework";

const health = defineHandler({
  run: () => TextRes("ok"),
});

export default defineHttpGraph({
  routes: {
    "GET /healthz": {
      response: "text",
      handler: health,
    },
  },
});
```

## Dependency Injection

Providers can be registered in a graph with `Provider()` and consumed through handler `useCase`
maps or `inject()` inside provider construction/request scopes.

```ts
import {
  JsonRes,
  Provider,
  Service,
  defineHandler,
  defineHttpGraph,
  type AppRequest,
} from "@warblerjs/framework";

@Service()
class ListUsers {
  execute(): readonly string[] {
    return ["Ada", "Grace"];
  }
}

const index = defineHandler({
  useCase: {
    listUsers: ListUsers,
  },
  run: (_request: AppRequest, { listUsers }) => JsonRes({
    users: listUsers.execute(),
  }),
});

export default defineHttpGraph({
  providers: [
    Provider({ provide: ListUsers, useClass: ListUsers }),
  ],
  routes: {
    "GET /users": index,
  },
});
```

Provider registrations support `useClass`, `useValue`, `useFactory`, and `useExisting`.
Provider lifetimes are `"singleton"` and `"transient"`. Provider visibility scopes are
`ProviderScope.GRAPH`, `ProviderScope.ROOT`, and `ProviderScope.REQUEST`; graph scope is the
default for provider decorators.

Provider decorators exported by the framework are `Service`, `Repository`, `Factory`, `Resolver`,
`Gateway`, and `Injectable`. HTTP controller/route decorators are still exported for compatibility,
but new documentation and starter files use declarative Graphs.

## Middleware and Guards

Middleware wraps the remaining pipeline; guards allow or short-circuit before the handler runs.

```ts
import {
  JsonRes,
  redirectTo,
  type Guard,
  type Middleware,
} from "@warblerjs/framework";

export const requestIdMiddleware: Middleware = (_request, context, next) => {
  context.set("requestId", crypto.randomUUID());
  return next();
};

export const authGuard: Guard = (_request, context) => {
  return context.get("user") === undefined
    ? redirectTo("login")
    : true;
};

export const denyGuard: Guard = () => JsonRes({ error: "forbidden" }, { status: 403 });
```

`context.set()` calls in middleware and guards are analyzed by the compiler and emitted into
`.warbler/generated/context.generated.d.ts`, which is included by the generated `tsconfig.json`.

## PostgreSQL

Warbler's PostgreSQL workflow is migration-first and introspection-based:

```text
migrations -> warbler db:pg migration -> PostgreSQL -> warbler db:pg generate -> generated client
```

The starter includes `src/config/database.config.ts`:

```ts
import { envBoolean, envNumber, envString } from "@warblerjs/config";

export const databaseConfig = {
  pg: {
    log: envBoolean("DB_LOG_QUERIES", false),
    connection: {
      adapter: "postgres" as const,
      url: envString("DATABASE_URL", ""),
      hostname: envString("DB_HOST", "localhost"),
      port: envNumber("DB_PORT", 5432),
      database: envString("DB_DATABASE", "warbler_development"),
      username: envString("DB_USERNAME", "warbler"),
      password: envString("DB_PASSWORD", ""),
      ssl: envBoolean("DB_SSL", false),
      max: envNumber("DB_POOL_MAX", 10),
      idleTimeout: envNumber("DB_IDLE_TIMEOUT", 30),
      connectionTimeout: envNumber("DB_CONNECTION_TIMEOUT", 10),
    },
    migrations: {
      table: "_wrbls_migrations",
      seedTable: "_warbler_seeds",
      generated: "database/warbler/pg/generated",
      path: "database/warbler/pg/migrations",
      seeds: "database/warbler/pg/seeds",
      softDelete: true,
    },
  },
} as const;
```

Database commands:

```bash
warbler db:pg migration create:table:user
warbler db:pg migration
warbler db:pg rollback
warbler db:pg rollback --step 2
warbler db:pg migrate:fresh
warbler db:pg migrate:fresh --seed
warbler db:pg generate
warbler db:pg seed:make users
warbler db:pg seed:run
warbler db:pg seed:run --only 0001_users.seed.ts
```

Supported migration scaffold kinds are `create:table`, `alter:table`, `rename:table`,
`drop:table`, `add:column`, `alter:column`, `rename:column`, `drop:column`, `create:index`,
`create:unique:index`, `drop:index`, `create:enum`, `alter:enum`, and `raw:custom`.

A migration exports `up` and `down` functions:

```ts
import type { PgMigration } from "@warblerjs/database";
import { OnDeleteAction, PgDefault, PgTypes } from "@warblerjs/database";

export const up: PgMigration = async (pgm) => {
  await pgm.createTable("users", {
    id: PgTypes.Uuid({ primaryKey: true, default: PgDefault.GenRandomUuid }),
    email: PgTypes.VarChar({ length: 255, nullable: false, unique: true }),
    createdAt: PgTypes.Timestamp({ default: PgDefault.Now, nullable: false }),
    updatedAt: PgTypes.Timestamp({ default: PgDefault.Now, nullable: false }),
    deletedAt: PgTypes.Timestamp({ nullable: true }),
  }, { softDelete: true });

  await pgm.createTable("profiles", {
    id: PgTypes.Uuid({ primaryKey: true, default: PgDefault.GenRandomUuid }),
    userId: PgTypes.Uuid({
      nullable: false,
      references: { table: "users", column: "id" },
      onDelete: OnDeleteAction.Cascade,
      unique: true,
    }),
  });
};

export const down: PgMigration = async (pgm) => {
  await pgm.dropTable("profiles");
  await pgm.dropTable("users");
};
```

The migration context supports `createTable`, `dropTable`, `renameTable`, `addColumns`,
`dropColumns`, `alterColumn`, `renameColumn`, `createIndex`, `dropIndex`, `createEnum`,
`dropEnum`, `alterEnum`, and `raw`.

PostgreSQL column builders include booleans, integers, serials, numeric/decimal, character
types, UUID, JSON/JSONB, date/time, network, full text, XML, bit, geometric, ranges,
multiranges, arrays, and enums through `PgTypes`.

After migrations have been applied, generate the typed client:

```bash
warbler db:pg generate
```

Generated client delegates include `findUnique`, `findUniqueOrThrow`, `findFirst`,
`findFirstOrThrow`, `findMany`, `create`, `insert`, `createMany`, `createManyAndReturn`,
`update`, `updateMany`, `updateManyAndReturn`, `upsert`, `delete`, `deleteMany`, `count`,
`exists`, `aggregate`, `groupBy`, and `explain.*`. Soft-delete tables also get `softDelete`,
`softDeleteMany`, `restore`, `restoreMany`, `forceDelete`, and `forceDeleteMany`.

Example repository using an app-owned import barrel:

```ts
// src/shared/database/pg.ts
export { WlbPg } from "../../../database/warbler/pg/generated/client";
export type {
  WlbPgClient,
  WlbPgTransactionClient,
} from "../../../database/warbler/pg/generated/client";
```

```ts
// src/graphs/users/infrastructure/users.repository.ts
import { Repository } from "@warblerjs/framework";
import { WlbPg } from "../../../shared/database/pg";

export interface UserSummary {
  readonly id: string;
  readonly email: string;
}

@Repository()
export class UsersRepository {
  async activeUsers(): Promise<readonly UserSummary[]> {
    return WlbPg.user.findMany({
      where: { isActive: true },
      select: { id: true, email: true },
      orderBy: { email: "asc" },
      take: 50,
    });
  }
}
```

Seeds are numbered files under `database/warbler/pg/seeds`:

```ts
import type { PgSeed } from "@warblerjs/database";
import type { WlbPgTransactionClient } from "../generated/client";

export const seed: PgSeed<WlbPgTransactionClient> = async (db) => {
  await db.user.createMany({
    data: [
      { email: "ada@example.com", isActive: true },
      { email: "grace@example.com", isActive: true },
    ],
    skipDuplicates: true,
  });
};
```

Run pending seeds with `warbler db:pg seed:run`. `migrate:fresh` and seed execution ask for
confirmation in interactive human output; JSON or non-interactive mode cancels destructive actions.

## Configuration

Runtime config lives in `src/config/runtime.config.ts` and must include every recognized transport:

```ts
import { envBoolean, envNumber, envString } from "@warblerjs/config";

export default {
  network: { host: envString("APP_HOST", "0.0.0.0"), bindInterface: undefined },
  transports: {
    http: { enabled: envBoolean("HTTP_ENABLED", true), port: envNumber("APP_HTTP_PORT", 3000) },
    websocket: { enabled: envBoolean("WS_ENABLED", false), mode: "standalone", port: envNumber("WS_PORT", 3001) },
    tcp: { enabled: envBoolean("TCP_ENABLED", false), port: envNumber("TCP_PORT", 9000) },
    udp: { enabled: envBoolean("UDP_ENABLED", false), port: envNumber("UDP_PORT", 9001) },
    mcp: { enabled: envBoolean("MCP_ENABLED", false), port: envNumber("MCP_PORT", 8080) },
    webrtc: { enabled: envBoolean("WEBRTC_ENABLED", false), signaling: { port: envNumber("WEBRTC_SIGNALING_PORT", 3002) } },
  },
  telemetry: {
    metrics: { enabled: false, host: envString("APP_HOST", "0.0.0.0"), port: 9090, path: "/metrics" },
    healthCheck: { enabled: false, host: envString("APP_HOST", "0.0.0.0"), port: 8081, path: "/healthz" },
  },
} as const;
```

HTTP config supports host/port, `allowedHosts`, body policies for JSON/text/url-encoded/multipart,
header/query/cookie/path limits, CSRF policy, security headers, static files, and rate-limit proxy
trust settings.

WebSocket config supports dedicated/shared HTTP mode, origin/host/protocol checks, optional
authentication requirement, JSON/text/binary message format, compression, timeouts, backpressure,
connection/subscription/event limits, and Bun socket options.

Logging config supports environment-aware request/runtime/transport/websocket/error/fatal/startup
and debug switches, plus console and daily file channels. Profiling config currently controls the
HTTP hot-path profiler and shutdown summary.

View config controls the Warbler view engine, template root, extension, public asset root, cache,
hot reload, minification, script/style entries, Tailwind processing, and development source maps.
Use the HTTP `view()` helper rather than calling `View()` directly when rendering inside a request:

```ts
import { defineHandler, view } from "@warblerjs/framework";

export const page = defineHandler({
  run: () => view("index", { title: "Warbler" }),
});
```

Mail config is read from `src/config/mail.config.ts` by `Email`. Built-in transports are `smtp`,
`log`, and `memory`; SMTP supports host, port, secure mode, auth, TLS certificate checking, and
timeouts.

Crypto config controls password hashing, encryption keys, HMAC keys, hashing output, encoding,
and random byte/token limits. Password hashing is Bun-backed today; encryption and HMAC use Web
Crypto-compatible key material boundaries.

There is no `packages/cache` package in v0.6.0. The implemented cache-related knobs are HTTP
static asset `cacheControl` and view template `cache`.

## WebSocket

Enable WebSocket in the application and runtime config:

```ts
import { createApp, Transport } from "@warblerjs/framework";

export default createApp({
  transports: [
    Transport.HTTP,
    Transport.WEBSOCKET,
  ],
  graphs: "src/graphs/**/*.graph.ts",
});
```

Declare socket events with `defineWebSocketGraph()`:

```ts
import { defineHandler, defineWebSocketGraph } from "@warblerjs/framework";

const onOpen = defineHandler({
  run: () => undefined,
});

export default defineWebSocketGraph({
  prefix: "/chat",
  middlewares: [],
  providers: [],
  events: {
    OPEN: {
      name: "chat.open",
      handler: onOpen,
    },
  },
});
```

Supported event keys are `OPEN`, `CLOSE`, `DRAIN`, `MSG <event>`, and `SUB <topic>`.
`SocketContext` exposes connection metadata, locale translation, `send`, `publish`, `join`,
`leave`, `isJoined`, `close`, and `cork`. The lower-level socket adapter is Bun-native in v0.6.0.

## CLI

Verified commands and flags:

```bash
warbler help
warbler version
warbler new my-app
warbler dev --host 127.0.0.1 --port 3000 --no-watch
warbler build --out dist --minify --sourcemap
warbler start
warbler doctor
warbler inspect
warbler inspect routes
warbler clean
warbler generate graph Auth
warbler make:graph users -a hexagonal -t http,socket
warbler db:pg generate
warbler db:pg migration
warbler db:pg migration create:table:user
warbler db:pg rollback --step 2
warbler db:pg migrate:fresh --seed
warbler db:pg seed:make users
warbler db:pg seed:run --only 0001_users.seed.ts
```

Common flags are `--project`, `--json`, `--verbose`, `--quiet`, `--no-color`, and `--help`.
`warbler inspect` accepts `summary`, `graphs`, `routes`, `providers`, `transports`, or `config`.
`warbler clean` removes `dist/` and `.warbler/`.

`warbler generate graph <Name>` is a legacy graph-only generator. Prefer `warbler make:graph`
for architecture-aware generation.

## Production

Build and run:

```bash
bun run build
bun run start
```

`warbler build` compiles the application, validates enabled transport configs, compiles views when
enabled, writes `.warbler/generated/view.generated.ts`, bundles a Bun target into `dist/server.js`,
copies `public/`, and writes `dist/.warbler/build-manifest.json`.

`warbler start` does not compile. It requires `dist/server.js` and a valid build manifest, then
launches the built server with Bun.

Current production launchers are available for HTTP and WebSocket. If runtime config enables TCP,
UDP, MCP, or WebRTC, `warbler build` fails because this repository does not provide production
launchers for those transports yet.

## Architecture and Portability

Warbler's portability boundary is intentional:

- Application handlers return native `Response` objects.
- Validation sees request sources, not Bun server internals.
- Middleware and guards use `AppRequest` plus Warbler's request context handle.
- Graphs declare transport intent without invoking runtime adapter APIs.
- Generated runtime code and current adapters are Bun-specific implementation details.

Today, Warbler runs on Bun and uses Bun APIs internally for the CLI, builds, the HTTP/WebSocket
adapters, PostgreSQL connections, and password hashing. Public application examples should stay on
Web Standards so future runtime adapters can preserve the same handler, middleware, guard, and
service contracts.

## Release Notes

`v0.6.0` adds compile-time HTTP response-kind metadata and the portable `response: "text"` route
option. It also specializes security-header profiles by response kind to reduce request hot-path
overhead for API and text responses.

Warbler uses lockstep versioning: the root release version, Git tag, GitHub release, and every
publishable `@warblerjs/*` package use the same version.

## License

Warbler is licensed under the [Apache License 2.0](./LICENSE).
