# Warbler Framework

> A Bun-native, compile-first application framework focused on performance, security, modular transports, and a small runtime.

---

## Status

Warbler is an architectural and implementation project under active development.

This document describes the intended architecture, developer experience, compilation model, runtime behavior, package boundaries, security principles, and Bun integration strategy. It must not be interpreted as a claim that every described package or feature is already complete.

---

## 1. What Is Warbler?

Warbler is a TypeScript framework designed specifically for Bun.

It is not intended to wrap Bun with a large compatibility layer. Instead, Warbler uses Bun's native capabilities directly and moves expensive framework work from runtime to build time.

The central idea is:

```text
Application TypeScript
        ↓
Warbler Compiler
        ↓
Optimized Warbler IR
        ↓
Generated Bun-native code and artifacts
        ↓
Small Warbler Runtime
        ↓
Bun native servers and APIs
```

Warbler aims to provide:

- Compile-time graph analysis
- Compile-time dependency analysis
- Native Bun HTTP routing
- Multiple transports
- Strict configuration validation
- Dependency injection
- Controllers, services, repositories, guards, policies, and validators
- Template compilation and HTML streaming
- Static asset handling
- OpenAPI generation
- Production bundling
- Optional binary compiled metadata
- Security-first defaults
- Fast startup and low runtime overhead

---

## 2. Core Philosophy

### 2.1 Compile First

Warbler performs expensive work before the application starts.

The compiler should discover and validate:

- Graphs
- Controllers
- Routes
- Providers
- Dependency relationships
- Transport usage
- Configuration files
- Validation policies
- Middleware relationships
- CSRF policies
- Template dependencies
- Static assets
- OpenAPI metadata

The runtime should not scan source files or rebuild dependency graphs.

### 2.2 Bun Native

Warbler should use Bun APIs instead of rebuilding features that Bun already implements.

Examples:

- `Bun.serve()` for HTTP and WebSocket servers
- `Bun.serve({ routes })` for HTTP routing
- `Bun.file()` for files and static assets
- `Bun.listen()` for TCP
- `Bun.udpSocket()` for UDP
- `Bun.build()` for production bundling
- Bun bundler plugins for generated modules and framework build integration
- `Bun.CSRF` for CSRF token generation and verification
- `Bun.deepEquals()` outside request hot paths
- `bun:test` for tests
- Bun workspaces for the monorepo

### 2.3 Runtime Executes, Compiler Thinks

The runtime should receive prepared instructions.

```text
Bad runtime behavior:

Request
  ↓
Scan decorators
  ↓
Resolve route
  ↓
Build middleware chain
  ↓
Parse configuration
  ↓
Resolve dependencies
  ↓
Execute handler
```

```text
Preferred Warbler behavior:

Build time:
  Analyze everything
  Generate route handler pipeline
  Generate dependency IDs
  Generate policy flags

Request time:
  Bun matches route
  Execute prepared handler
```

### 2.4 Security Must Fail Closed

An invalid security value must never disable protection silently.

For example, an invalid body limit must produce a build or startup error.

```text
Invalid:

maxBodySize: "large"
maxBodySize: NaN
maxBodySize: Infinity
maxBodySize: -1
```

Warbler must not convert these values to `undefined` and continue.

### 2.5 Respect the Event Loop

Warbler must avoid unnecessary work in request and event handlers.

Do not:

- Poll without a real requirement
- Block the event loop
- Perform synchronous filesystem work in request handlers
- Deep-clone request data
- Reparse configuration per request
- Rebuild route tables per request
- Create unnecessary promises for synchronous handlers
- Perform linear route scans
- Use `Bun.deepEquals()` inside request hot paths

---

## 3. Monorepo Structure

Warbler should use a single repository with Bun workspaces.

```text
warbler/
├── package.json
├── bun.lock
├── tsconfig.json
├── packages/
│   ├── core/
│   ├── config/
│   ├── transport/
│   ├── http/
│   ├── websocket/
│   ├── tcp/
│   ├── udp/
│   ├── webrtc/
│   ├── mcp/
│   ├── view/
│   ├── validator/
│   ├── security/
│   ├── runtime/
│   ├── compiler/
│   ├── bundler/
│   ├── cli/
│   └── framework/
├── playground/
│   ├── package.json
│   ├── public/
│   ├── resources/
│   └── src/
└── docs/
```

Each major module is a separate package with its own:

- `package.json`
- `tsconfig.json`
- Public API
- Tests
- README

The repository should normally have one workspace-managed installation rather than manually maintained `node_modules` folders inside every package.

---

## 4. Package Responsibilities

### `@warbler/core`

Owns framework-neutral concepts:

- `createApp()`
- `Graph`
- `Service`
- `Repository`
- `Injectable`
- `inject()`
- Dependency container contracts
- Provider tokens
- Metadata utilities
- `Transport` identifiers

It must not own HTTP-specific decorators.

```ts
import {
  Graph,
  Service,
  Repository,
  inject,
  Transport,
} from "@warbler/core";
```

### `@warbler/config`

Owns:

- Config discovery
- Config loading
- Strict parsing
- Validation
- Normalization
- Immutable normalized config

It must reject invalid values instead of silently using defaults.

### `@warbler/transport`

Owns transport-neutral contracts:

- Adapter contracts
- Lifecycle
- Start and stop contexts
- Handles
- Registry
- Typed transport errors
- `MaybePromise`

It must not contain HTTP, WebSocket, TCP, UDP, MCP, or WebRTC implementations.

### `@warbler/http`

Owns:

- `Controller`
- HTTP method decorators
- HTTP request contracts
- Native `Response` helpers
- Bun native route generation contracts
- HTTP server ownership
- Body policies
- Cookies
- CSRF pipeline integration
- Static assets
- File responses
- HTML streams
- Server-Sent Events
- Security headers

### `@warbler/websocket`

Owns:

- `SocketController`
- `OnOpen`
- `Subscribe`
- `OnMessage`
- `OnClose`
- `OnError`
- Socket contexts
- Backpressure behavior
- Bun native WebSocket integration

### `@warbler/view`

Owns:

- Template parser
- Template compiler
- Layouts
- Partials
- Rendering
- Streaming rendering
- Optional HTML post-processing
- Build-time asset and link extraction

### `@warbler/compiler`

Owns:

- Source analysis
- Graph analysis
- Route analysis
- Dependency graph analysis
- WIR generation
- Optimization
- String table construction
- Diagnostics
- Generated code
- OpenAPI generation
- Optional binary artifacts

### `@warbler/runtime`

Owns:

- Loading compiled application artifacts
- Creating provider instances
- Starting enabled transports
- Coordinating shutdown
- Executing generated pipelines

It must remain small.

### `@warbler/bundler`

Owns Bun build integration:

- Bun bundler plugin
- Virtual modules
- Generated route modules
- Compiled templates
- Build constants
- Build reports
- Emitted artifacts

### `@warbler/cli`

Owns commands such as:

```bash
warbler dev
warbler build
warbler start
warbler test
warbler inspect
```

---

## 5. Developer Application Structure

```text
playground/
├── package.json
├── public/
│   ├── images/
│   ├── css/
│   ├── js/
│   ├── fonts/
│   └── downloads/
├── resources/
│   └── views/
└── src/
    ├── main.ts
    ├── config/
    │   ├── runtime.config.ts
    │   └── transports/
    │       ├── http.config.ts
    │       ├── ws.config.ts
    │       ├── tcp.config.ts
    │       ├── udp.config.ts
    │       ├── mcp.config.ts
    │       └── webrtc.config.ts
    └── graphs/
        ├── auth/
        └── chat/
```

---

## 6. Application Entry Point

`createApp()` should remain simple.

```ts
import { createApp } from "@warbler/core";

import AuthGraph from "./graphs/auth/auth.graph";
import ChatGraph from "./graphs/chat/chat.graph";

export default createApp({
  graphs: [
    AuthGraph,
    ChatGraph,
  ],
});
```

Transport configuration is discovered through project conventions rather than passed directly to `createApp()`.

---

## 7. Graphs

A Graph groups controllers and providers.

HTTP is the default transport.

```ts
import { Graph } from "@warbler/core";

import AuthController from "./auth.controller";
import AuthService from "./auth.service";
import AuthRepository from "./auth.repository";

@Graph({
  prefix: "/api/auth",

  controllers: [
    AuthController,
  ],

  providers: [
    AuthService,
    AuthRepository,
  ],
})
export default class AuthGraph {}
```

A WebSocket Graph explicitly selects its transport.

```ts
import {
  Graph,
  Transport,
} from "@warbler/core";

import ChatSocketController from "./chat.socket-controller";
import ChatService from "./chat.service";
import ChatRepository from "./chat.repository";

@Graph({
  prefix: "/chat",
  transport: Transport.WEBSOCKET,

  controllers: [
    ChatSocketController,
  ],

  providers: [
    ChatService,
    ChatRepository,
  ],
})
export default class ChatGraph {}
```

Warbler uses one property, `prefix`, across transports. Each transport adapter interprets the prefix according to its protocol.

Graph options should stay focused:

```ts
export interface GraphOptions {
  readonly prefix?: string;
  readonly transport?: Transport;
  readonly controllers?: readonly Constructor[];
  readonly providers?: readonly Constructor[];
}
```

Warbler intentionally avoids Nest-style `imports` and `exports` in Graphs. The compiler builds the dependency graph directly.

---

## 8. Dependency Injection

Warbler supports Angular-style functional injection.

```ts
import {
  Service,
  inject,
} from "@warbler/core";

@Service()
export default class AuthService {
  private readonly repository =
    inject(AuthRepository);
}
```

Controller example:

```ts
import { inject } from "@warbler/core";

import {
  Controller,
  Post,
  JsonRes,
  type AppRequest,
} from "@warbler/http";

@Controller()
export default class AuthController {
  private readonly authService =
    inject(AuthService);

  @Post("/login", { validator: loginValidator })
  async login(
    request: AppRequest<typeof loginValidator>,
  ): Promise<Response> {
    const result =
      await this.authService.login(
        request.body,
      );

    return JsonRes(result);
  }
}
```

The compiler should detect calls such as:

```ts
inject(AuthService)
```

and build provider dependency relationships during compilation.

Runtime resolution should use stable provider IDs where possible.

```text
AuthRepository → provider 0
AuthService    → provider 1
AuthController → provider 2
```

Request-scoped injection must use safe asynchronous context management. A single global mutable active container is not safe for concurrent request scopes.

**Not to be confused with request *context*** (§18a): request-scoped DI
providers (above) are resolved via `inject()` from an `AsyncLocalStorage`-backed
container, because `inject()` is called ambiently with no request object in
scope. `req.context` is a different, simpler mechanism — a plain per-request
object threaded explicitly as a guard/middleware argument, populated by
`context.set(...)` and read via `req.context.someKey` in the controller. Use
request-scoped providers for services that need their own per-request
instance and lifecycle (`dispose()`); use request context for passing
already-computed per-request values (the authenticated user, a resolved
tenant) downstream to guards, middleware, and the handler.

---

## 9. Runtime Configuration

`playground/src/config/runtime.config.ts` defines enabled infrastructure.

```ts
export default {
  network: {
    host: "0.0.0.0",
    bindInterface: undefined,
  },

  transports: {
    http: {
      enabled: true,
      port: 3000,
    },

    websocket: {
      enabled: true,
      mode: "shared-http",
      port: 8443,
    },

    tcp: {
      enabled: false,
      port: 9000,
    },

    udp: {
      enabled: false,
      port: 9001,
    },

    mcp: {
      enabled: false,
      port: 8080,
    },

    webrtc: {
      enabled: false,
      signaling: {
        port: 3001,
      },
    },
  },

  telemetry: {
    metrics: {
      enabled: true,
      host: "127.0.0.1",
      port: 9090,
      path: "/metrics",
    },

    healthCheck: {
      enabled: true,
      host: "127.0.0.1",
      port: 8081,
      path: "/healthz",
    },
  },
} as const;
```

---

## 10. Lazy Transport Loading

Warbler loads configuration and implementation only for enabled transports.

```text
Load runtime.config.ts
        ↓
Find enabled transports
        ↓
Validate Graph usage
        ↓
Load only enabled transport config files
        ↓
Load only enabled adapter packages
        ↓
Start enabled transports
```

Example:

```text
HTTP enabled
→ load http.config.ts
→ load @warbler/http

WebSocket disabled
→ do not import ws.config.ts
→ do not load @warbler/websocket
→ do not register WebSocket Graphs
```

If an enabled transport has no config file, Warbler must fail clearly.

```text
WARBLER_TRANSPORT_CONFIG_MISSING

Transport:
  websocket

Expected:
  playground/src/config/transports/ws.config.ts
```

If a transport is disabled, Warbler should produce a diagnostic and skip it. It should not start a listener only to respond that the listener is disabled.

---

## 11. Strict Configuration Parsing

All external config values are untrusted input.

Normalized adapters should receive numbers and validated values rather than strings.

```ts
export interface NormalizedWebSocketConfig {
  readonly maxPayloadSize: number;

  readonly timeouts: {
    readonly idleMs: number;
    readonly upgradeMs: number;
  };
}
```

Raw:

```ts
export default {
  maxPayloadSize: "1mb",

  timeouts: {
    idle: "60s",
    upgrade: "5s",
  },
} as const;
```

Normalized:

```text
maxPayloadSize → 1048576
idle           → 60000
upgrade        → 5000
```

Invalid values must throw.

```text
"abc"          → error
"10 elephant"  → error
NaN            → error
Infinity       → error
0              → error when positive required
-1             → error
null           → error when not nullable
```

Optional means that `undefined` may select a documented default. It does not mean that invalid values silently select a default.

---

## 12. Warbler Intermediate Representation

Warbler IR, or WIR, is the compiler's internal application model.

It is not TypeScript source, JSON, or binary. It is a typed semantic representation used before output generation.

```text
TypeScript source
      ↓
Analyzer
      ↓
Semantic model
      ↓
Optimized WIR
      ├── Bun route module
      ├── OpenAPI
      ├── Client SDK
      ├── Debug JSON
      └── Production binary
```

Example HTTP route IR:

```ts
export interface CompiledHttpRoute {
  readonly methodId: number;
  readonly pathId: number;
  readonly controllerId: number;
  readonly handlerId: number;
  readonly flags: number;
  readonly csrfPolicyId: number;
  readonly validationPolicyId: number;
}
```

The WIR should contain execution-ready information rather than raw decorator text.

One compiler output is intentionally *not* a runtime artifact: the analysis
of every `context.set(...)` call in every referenced guard/middleware (§18a)
resolves each call's key and value type using the same `TypeChecker`-backed
declaration resolution the compiler already uses for provider/controller/
validator bindings, and feeds a pure type-level `.d.ts` generator instead of
a `.generated.ts` value module.

---

## 13. String Tables

Repeated strings should be interned during compilation.

```text
0 → GET
1 → /users
2 → UserController
3 → index
```

A compiled record stores IDs:

```ts
{
  methodStringId: 0,
  pathStringId: 1,
  controllerStringId: 2,
  handlerStringId: 3,
}
```

String table construction belongs to the compiler.

```ts
export class StringTableBuilder {
  readonly #ids = new Map<string, number>();
  readonly #values: string[] = [];

  intern(value: string): number {
    const existing = this.#ids.get(value);

    if (existing !== undefined) {
      return existing;
    }

    const id = this.#values.length;

    this.#values.push(value);
    this.#ids.set(value, id);

    return id;
  }

  build(): readonly string[] {
    return Object.freeze(
      this.#values.slice(),
    );
  }
}
```

Do not build or scan string tables during each request.

---

## 14. Route Flags

Frequently checked boolean policies should be compiled into flags.

```ts
export const RouteFlag = {
  CSRF_ENABLED: 1 << 0,
  BODY_ENABLED: 1 << 1,
  STREAMING: 1 << 2,
  SSE: 1 << 3,
  STATIC_RESPONSE: 1 << 4,
  FILE_RESPONSE: 1 << 5,
  HTML_RESPONSE: 1 << 6,
} as const;
```

Request-time check:

```ts
const csrfEnabled =
  (route.flags & RouteFlag.CSRF_ENABLED) !== 0;
```

This avoids repeated traversal of nested configuration objects.

---

## 15. Development and Production Artifacts

### Development

Development should favor debugging and readability.

```text
.warbler/
├── app.ir.json
├── routes.json
├── providers.json
└── diagnostics.json
```

JSON is useful for inspection, but Bun-native generated modules may still be used for actual execution.

### Production

Production may use:

```text
dist/
├── server.js
└── .warbler/
    └── app.wbc
```

`.wbc` means Warbler Binary Compiled artifact.

The binary is a storage format for optimized WIR. It is not passed directly to:

```ts
Bun.serve({ routes })
```

`Bun.serve()` receives a JavaScript route object.

```text
app.wbc
   ↓
Decode once at startup
   ↓
Create Bun route object
   ↓
Bun.serve({ routes })
```

For Bun HTTP routes, generated JavaScript embedded in the bundle may be faster than decoding binary. Warbler can use:

- Generated Bun route modules for executable routes
- `.wbc` for portable compiled metadata

---

## 16. HTTP and Bun Native Routing

Warbler must pass normal routes to Bun:

```ts
Bun.serve({
  routes,
  fetch: fallbackFetch,
});
```

Bun's native router supports static paths, parameters, and wildcards. Warbler should not build its own request-time route matcher.

Generated route object:

```ts
const routes = {
  "/api/users/:id": {
    GET: userShowHandler,
    DELETE: userDeleteHandler,
  },

  "/api/users": {
    POST: userCreateHandler,
  },
};
```

`fetch` is only a fallback for unmatched requests or limited infrastructure behavior.

```ts
const server = Bun.serve({
  port: 3000,
  routes,

  fetch() {
    return new Response(
      "Not Found",
      { status: 404 },
    );
  },
});
```

---

## 17. HTTP Controller Example

`AppRequest`'s first generic accepts a validator itself — not a hand-built body
type — and derives `body`/`params`/`query` from its `bodyRules`/`paramRules`/
`queryRules` sections automatically. Bare `AppRequest` (no generics at all) is
also valid: `body`/`params`/`query` stay permissive, but `context` is always
fully typed against the compiler-generated `WarblerRequestContext` (§18a)
regardless of whether a generic was supplied.

```ts
import { inject } from "@warbler/core";
import { Controller, Get, Post, JsonRes, defineValidator, v, type AppRequest } from "@warbler/http";

const createUserValidator = defineValidator({
  bodyRules: { email: v.string(), password: v.string() },
});
const showUserValidator = defineValidator({
  paramRules: { id: v.string() },
});

@Controller("/users")
export default class UserController {
  private readonly service = inject(UserService);

  @Get("/:id", { validator: showUserValidator })
  async show(request: AppRequest<typeof showUserValidator>): Promise<Response> {
    const user = await this.service.findById(request.params.id);
    return JsonRes(user);
  }

  @Post("/", { validator: createUserValidator })
  async create(request: AppRequest<typeof createUserValidator>): Promise<Response> {
    const user = await this.service.create(request.body);
    return JsonRes(user, { status: 201 });
  }
}
```

A route with no validator just takes `AppRequest` (bare): `async list(request: AppRequest)`.

TypeScript decorators cannot contextually type an unannotated handler
parameter (the decorated method's type is checked against the decorator, not
inferred from it), so the single-generic annotation above is required — it
isn't optional sugar the way `AppRequest<CreateUserInput>` used to be.

---

## 17a. Custom Validation Failure Responses (`onValidationError`)

By default, a request that fails a route's validator short-circuits straight
to Warbler's default validation-error response — `Response.json({ [field]:
message }, { status: 400 })`, one translated message per failing field — and
the controller never runs. `defineValidator(...)` accepts an optional
`onValidationError(req, errors)` that overrides that default:

```text
Request → Validator → Validation → Valid?
                                     ├─ YES → continue pipeline → controller
                                     └─ NO
                                          ↓
                                        onValidationError exists?
                                          ├─ YES → run handler → its Response is used → stop
                                          └─ NO  → default validation response → stop
```

The controller never executes once validation has failed, regardless of
which branch runs.

```ts
import { defineValidator, v } from "@warbler/validators";
import { view } from "@warbler/view";

export const validateUserId = defineValidator({
  paramRules: {
    id: v.uuid("id_invalid_uuid"),
  },
  headerRules: {
    "x-retries": v.coerce
      .number("validators.invalid_retries")
      .int("validators.invalid_retries")
      .nonnegative("validators.invalid_retries"),
  },
  onValidationError(req, errors) {
    return view("auth.login", {
      errors,
      old: req.body,
    });
  },
});
```

- **Signature**: `(req: ValidationRequest, errors: ValidationErrors) =>
  Response | Promise<Response>`, both sync and async are supported.
- **`req`**: the raw, un-validated request. `native`, `headers` (a real
  `Headers`), `cookies` (a real `Bun.CookieMap`), `context`, `locale`, and
  `tr(...)` all behave exactly as on a successfully-validated `AppRequest` —
  but `body`/`params`/`query` stay `unknown`, deliberately never typed as the
  validated output, since validation failed.
- **`errors`**: the same structured `ValidationErrors` produced internally by
  the compiled validator (`{ "body.field": [{ source, path, field, code,
  message }] }`) — passed through untranslated and unmodified.
- **Independent of which sections are used**: works the same whether the
  validator declares `bodyRules`, `queryRules`, `paramRules`, `headerRules`,
  `cookieRules`, or any combination — `onValidationError` is a property of the
  validator definition itself, not tied to a particular rule section.
- **Errors from the handler itself**: a throw or rejection inside
  `onValidationError` is not caught or converted into another validation
  failure — it propagates through Warbler's ordinary runtime/HTTP error
  handling, exactly like a controller throwing.
- **`@warbler/validators` has no dependency on `@warbler/view`** — the example
  above works because application code imports both independently; the
  validator package only needs its return value to be `Response`-compatible.
- **Backward compatible**: validators that don't define `onValidationError`
  are entirely unaffected — same default status, payload shape, error codes,
  translation, and logging as before.

Compiler/runtime plumbing: `compileValidator(...)` carries `onValidationError`
onto the compiled validator alongside its schemas; the compiler's generated
`validators.generated.ts` re-exposes it on each `validatorBindings` entry
(function identity preserved — never serialized); the Runtime calls it in
place of the default response builder when present, building the request the
same way the successful path does (`§18` below), just against the raw input
instead of the validated one.

---

## 18. Request Pipeline

Bun performs native route matching first.

Warbler's generated route handler executes the precomputed pipeline.

```text
Bun native route match
        ↓
Host and request-header checks
        ↓
Timeout policy
        ↓
CSRF check when enabled
        ↓
Body parsing when required
        ↓
Input validation
        ↓
AppRequest construction (every route, validator or not)
        ↓
Guards — (req, context) => boolean
        ↓
Middleware — (req, context, next) => Response
        ↓
Request context settle() — freezes req.context
        ↓
Controller handler
        ↓
Response security headers
```

The compiler should generate only the steps required by each route.

Every route builds a real `AppRequest` now, whether or not it declares a
validator — previously, a route with no validator handed the raw native
`Request` straight to guards/middleware/handler despite being typed as
`AppRequest`. `req.headers` is always the real `Headers` object and
`req.cookies` is always a `Bun.CookieMap`; validation of headers/cookies
(`headerRules`/`cookieRules`) is a pass/fail gate only — it never swaps
`req.headers`/`req.cookies` for a different value, unlike `req.body`.

---

## 18a. Guards, Middleware, and Request Context

Guards and middleware receive the same `AppRequest` the controller handler
will see, plus a request-scoped context handle:

```ts
import type { Guard, Middleware } from "@warbler/http";

export const authGuard: Guard = async (req, context) => {
  const user = await authenticate(req);
  if (user === undefined) return false;
  context.set("user", user);
  return true;
};

export const auditMiddleware: Middleware = async (req, context, next) => {
  context.set("tenant", () => resolveTenant(req)); // sync factory
  context.set("requestId", async () => generateRequestId()); // async factory
  return next();
};
```

`context.set(key, value)` accepts:

- a plain value — `context.set("user", user)`, type inferred;
- an explicit generic — `context.set<User>("user", user)`;
- a synchronous factory — `context.set("requestId", () => makeId())`;
- an asynchronous factory — `context.set("session", async () => loadSession())`.

The context handle also has `.get(key)`, so a later guard or middleware can
read back what an earlier one set. Async factories are resolved once,
immediately before the controller handler runs; a guard/middleware running
between the `.set()` call and that point may see `undefined` for that key if
it reads it back before the factory settles.

Guards run in order first; a `false` return short-circuits the request as
`403 Forbidden`. Middleware then wraps the remaining pipeline exactly like
Express/Koa middleware — call `next()` to continue, or return a value
directly to short-circuit. `req.context` is mutable while guards/middleware
run and frozen the moment the controller handler is about to be invoked;
guards, middleware, and the handler all see the same `req` object end to end
(the underlying context store transitions from mutable to frozen in place —
nothing is rebuilt or reallocated).

This is deliberately a *different* mechanism from Core's request-scoped
dependency injection (§8): request-scoped providers use an
`AsyncLocalStorage`-backed container because `inject()` is called ambiently,
with no request object in scope. Request context is threaded as an explicit
parameter through calls the pipeline already makes, so it needs neither
`AsyncLocalStorage` nor a `Map` — the store is a plain, per-request object.

### Generated `WarblerRequestContext`

The compiler statically analyzes every `context.set(...)` call site in every
guard and middleware the application references, extracting each call's key
and value type, and emits a `WarblerRequestContext` interface via TypeScript
declaration merging:

```ts
// .warbler/generated/context.generated.d.ts — regenerated on every compile
import type { User } from "../../src/graphs/auth/user.entity";
import type { Tenant } from "../../src/graphs/tenant/tenant.entity";

declare module "@warbler/http" {
  interface WarblerRequestContext {
    readonly user?: User;
    readonly tenant?: Tenant;
  }
}
```

Every key is optional: the compiler can't statically prove every request
path actually calls `.set()` for it. This is the one generated artifact
that's pure type-level — unlike every other `.generated.ts` file, it has no
runtime import/export.

`AppRequest`'s `TContext` generic defaults to this same `WarblerRequestContext`
interface, so `req.context.user`/`req.context.tenant` are fully typed with
IntelliSense in every controller, with **zero generics** — this works even
for a bare `AppRequest` annotation, since context is app-wide rather than
derived per-route from a validator.

For this to type-check, the project's `tsconfig.json` needs `warbler-env.d.ts`
(written to the project root by `warbler dev`/`warbler build`, alongside
`.warbler/generated/`) included — the same pattern Next.js uses for
`next-env.d.ts`. A newly scaffolded Warbler project has this wired up
automatically.

---

## 19. CSRF

Warbler integrates Bun's native CSRF capabilities.

Global config:

```ts
export default {
  csrf: {
    enabled: true,

    methods: [
      "POST",
      "PUT",
      "PATCH",
      "DELETE",
    ],

    headerName: "x-csrf-token",
    cookieName: "__Host-warbler-csrf",
  },
} as const;
```

Route override:

```ts
@Post("/login", {
  csrf: false,
})
```

```ts
@Post("/profile", {
  csrf: true,
})
```

CSRF verification must happen before entering the controller.

A failed request should normally return:

```text
403 Forbidden
CSRF validation failed.
```

Never expose tokens, secrets, or expected signatures in the error.

---

## 20. Request Body Security

Recommended starting policy:

```text
Total body:
  10mb

JSON:
  limit: 1mb
  maxDepth: 12
  maxKeys: 2000

Text:
  limit: 1mb

URL encoded:
  limit: 1mb
  maxFields: 1000
  maxFieldSize: 64kb

Multipart:
  totalLimit: 20mb
  maxFiles: 10
  maxFileSize: 5mb
  maxFields: 100
  maxFieldSize: 64kb

Unknown content type:
  reject
```

Limits are parsed and normalized before the server starts.

A malformed limit must never disable enforcement.

---

## 21. Static Assets and File Responses

The public directory is:

```text
playground/public/
```

It may contain:

- Images
- JavaScript
- CSS
- Fonts
- PDFs
- ZIP files
- Downloadable files

Use `Bun.file()` so large files are not eagerly loaded into JavaScript memory.

```ts
return new Response(
  Bun.file(
    "./public/reports/report.pdf",
  ),
);
```

Static routes may be generated at build time:

```ts
const routes = {
  "/favicon.ico":
    Bun.file("./public/favicon.ico"),

  "/app.css":
    Bun.file("./public/app.css"),

  "/app.js":
    Bun.file("./public/app.js"),
};
```

Static serving must reject:

- Path traversal
- Encoded traversal
- Null bytes
- Files outside public root
- Hidden files by default

---

## 22. HTML and Template Streaming

Small pages may return a string:

```ts
return HtmlRes(
  "<h1>Warbler</h1>",
);
```

Large or progressive views may stream:

```ts
return new Response(
  renderViewStream(
    "users.index",
    data,
  ),
  {
    headers: {
      "content-type":
        "text/html; charset=utf-8",
    },
  },
);
```

Streaming must:

- Respect backpressure
- Stop on request abort
- Avoid collecting all chunks
- Set headers before streaming
- Avoid exposing production stack traces

---

## 23. Server-Sent Events

Warbler supports SSE through native streaming responses.

```ts
@Sse("/events")
events(): Response {
  return SseRes(
    async function* () {
      yield {
        event: "ready",
        data: {
          connected: true,
        },
      };
    },
  );
}
```

Required response headers:

```text
Content-Type: text/event-stream; charset=utf-8
Cache-Control: no-cache
Connection: keep-alive
X-Accel-Buffering: no
```

Long-lived streams may disable the per-request idle timeout through Bun's server API.

SSE must not create hidden polling or heartbeat intervals. Heartbeats are explicit application configuration.

---

## 24. WebSocket Graph and Controller

```ts
import {
  Graph,
  Transport,
} from "@warbler/core";

@Graph({
  prefix: "/chat",
  transport: Transport.WEBSOCKET,
  controllers: [
    ChatSocketController,
  ],
  providers: [
    ChatService,
    ChatRepository,
  ],
})
export default class ChatGraph {}
```

Socket controller:

```ts
import { inject } from "@warbler/core";

import {
  SocketController,
  OnOpen,
  Subscribe,
  OnMessage,
  OnClose,
  OnError,
  type SocketContext,
  type SocketMessage,
} from "@warbler/websocket";

@SocketController()
export default class ChatSocketController {
  private readonly service =
    inject(ChatService);

  @OnOpen()
  connected(
    context: SocketContext,
  ): void {
    context.send({
      event: "connection.ready",
      data: {
        connectionId:
          context.connection.id,
      },
    });
  }

  @Subscribe("room.join")
  async joinRoom(
    message: SocketMessage<{
      readonly roomId: string;
    }>,
    context: SocketContext,
  ): Promise<void> {
    await this.service.joinRoom({
      roomId: message.data.roomId,
      connectionId:
        context.connection.id,
    });

    context.join(
      message.data.roomId,
    );
  }

  @Subscribe("chat.message")
  async sendMessage(
    message: SocketMessage<{
      readonly roomId: string;
      readonly content: string;
    }>,
    context: SocketContext,
  ): Promise<void> {
    const saved =
      await this.service.createMessage(
        message.data,
      );

    context.publish(
      message.data.roomId,
      {
        event:
          "chat.message.created",
        data: saved,
      },
    );
  }

  @OnMessage()
  fallback(
    message: SocketMessage<unknown>,
    context: SocketContext,
  ): void {
    context.send({
      event:
        "socket.unsupported-event",
      data: {
        receivedEvent:
          message.event,
      },
    });
  }

  @OnClose()
  disconnected(
    context: SocketContext,
  ): void {
    this.service.disconnect(
      context.connection.id,
    );
  }

  @OnError()
  error(
    error: unknown,
    context: SocketContext,
  ): void {
    context.log.error(error);
  }
}
```

---

## 25. Template Engine and HTMLRewriter

The Warbler template compiler owns:

- Variables
- Conditions
- Loops
- Imports
- Layouts
- Partials
- Yield sections

Bun's `HTMLRewriter` may be used after rendering for:

- Live reload script injection
- CSP nonce injection
- Asset extraction
- Link extraction
- External link hardening
- Image attribute optimization

It must not replace the template compiler.

```text
Template source
      ↓
Warbler template compiler
      ↓
Rendered HTML
      ↓
Optional HTMLRewriter pass
      ↓
Final response
```

---

## 26. OpenAPI

The compiler may generate OpenAPI from the WIR.

```text
WIR
 ├── Bun routes
 ├── app.wbc
 ├── openapi.json
 └── generated client
```

OpenAPI enables:

- Swagger-compatible documentation
- Postman and Insomnia import
- Generated TypeScript clients
- API change validation
- SDK generation for other languages

OpenAPI generation should be an exporter. It should not require source analysis to run twice.

---

## 27. Bun Bundler Plugin

Warbler can integrate with `Bun.build()` using a plugin.

Virtual modules:

```ts
import routes from "warbler:routes";
import config from "warbler:config";
import views from "warbler:views";
```

The plugin can use:

- `onStart()` to trigger compilation
- `onResolve()` for `warbler:` modules
- `onLoad()` to generate modules
- `onEnd()` to emit reports and artifacts

Generated application server:

```ts
import routes from "warbler:routes";

Bun.serve({
  routes,
});
```

For HTTP routes, generated code inside the bundle may avoid reading and decoding a route manifest at startup.

---

## 28. Build-Time Constants

`Bun.build()` defines can inject build constants.

```ts
declare const WARBLER_DEV: boolean;
declare const WARBLER_VERSION: string;
declare const WARBLER_MANIFEST_FORMAT:
  | "json"
  | "binary";
```

Build:

```ts
await Bun.build({
  entrypoints: [
    "./playground/src/server.ts",
  ],

  outdir: "./dist",
  target: "bun",

  define: {
    WARBLER_DEV: "false",

    WARBLER_VERSION:
      JSON.stringify("0.1.0"),

    WARBLER_MANIFEST_FORMAT:
      JSON.stringify("binary"),
  },
});
```

This lets Bun remove development-only branches from production bundles.

Do not place secrets in build constants.

---

## 29. Build Command

Target developer experience:

```bash
warbler build
```

Output:

```text
dist/
├── server.js
├── public/
└── .warbler/
    ├── app.wbc
    ├── openapi.json
    └── build-manifest.json
```

Production run:

```bash
bun ./dist/server.js
```

Possible build pipeline:

```text
Validate project layout
        ↓
Load runtime config
        ↓
Discover enabled transports
        ↓
Load enabled transport configs
        ↓
Analyze Graphs
        ↓
Build dependency graph
        ↓
Build optimized WIR
        ↓
Generate routes and templates
        ↓
Generate OpenAPI
        ↓
Optionally encode app.wbc
        ↓
Run Bun.build()
        ↓
Emit dist/
```

---

## 30. Suggested CLI

```bash
warbler dev
warbler build
warbler start
warbler test
warbler inspect
warbler routes
warbler config:check
warbler graph
```

### `warbler dev`

- Watch source files
- Incrementally compile affected Graphs
- Reload Bun routes when materially changed
- Inject view live reload
- Keep readable diagnostics

### `warbler build`

- Strict production validation
- Compile WIR
- Generate route modules
- Compile templates
- Bundle server
- Emit production artifacts

### `warbler start`

- Run the production server
- Start enabled transports
- Handle graceful shutdown

---

## 31. Development Reload

Bun can reload server routes without restarting the process.

```ts
server.reload({
  routes: nextRoutes,
});
```

Warbler may compare old and new compiled route metadata outside the request path.

```ts
if (
  !Bun.deepEquals(
    previousRoutes,
    nextRoutes,
    true,
  )
) {
  server.reload({
    routes: nextNativeRoutes,
  });
}
```

`Bun.deepEquals()` must not be used for:

- Request validation
- Routing
- CSRF
- Cookies
- Streaming loops
- Every request

---

## 32. Cluster and Multiple Processes

Production may run multiple Bun processes using `reusePort` where supported.

```ts
Bun.serve({
  port: 3000,
  reusePort: true,
  routes,
});
```

A CLI cluster manager may start multiple worker processes.

Each worker has its own:

- JavaScript heap
- Provider instances
- Database pool
- Compiled artifact load
- Route object

Database pool limits must account for worker count.

```text
Total allowed connections: 40
Workers: 8
Pool per worker: 5
```

Cluster should remain disabled during ordinary development.

---

## 33. Security Baseline

Warbler HTTP security should cover:

- Allowed host validation
- Trusted proxy configuration
- Header count and size limits
- Query limits
- Cookie limits
- Path limits
- Request timeouts
- Body limits
- Content-type policy
- CSRF
- Secure cookie rules
- Security response headers
- Error sanitization
- File path boundaries
- Static asset MIME handling

Suggested response headers:

- Content-Security-Policy
- Strict-Transport-Security
- X-Frame-Options
- X-Content-Type-Options
- Referrer-Policy
- Permissions-Policy
- Cross-Origin-Opener-Policy
- Cross-Origin-Resource-Policy

Never emit `X-Powered-By`.

---

## 34. Testing

Use only:

```bash
bun test
```

Every package should also pass:

```bash
tsc --noEmit
```

Requirements:

- Strict TypeScript
- No `any`
- No `@ts-nocheck`
- No placeholder implementation
- No hidden fallback for invalid security config
- Deterministic tests
- Public API tests
- Lifecycle tests
- Compiler output tests
- Native Bun route shape tests
- Security policy tests

---

## 35. Performance Rules

### Hot path

Avoid:

- Route scanning
- Dynamic reflection
- Configuration parsing
- Dependency graph traversal
- Repeated nested config lookups
- Deep equality
- JSON clone operations
- Repeated regular-expression compilation
- Unnecessary asynchronous wrappers

Prefer:

- Native Bun route match
- Prebound handlers
- Numeric IDs
- Route flags
- Direct array indexing
- `Map` during compilation
- Immutable normalized startup data
- Static response values when safe
- `Bun.file()` for files
- Streams for large output

### Startup path

Startup may:

- Decode an artifact once
- Create providers
- Build native route objects
- Start enabled transports

It must not reanalyze TypeScript source in production.

---

## 36. Why Warbler Can Be Fast

Warbler does not become fast merely by using binary files.

The main performance gains come from:

1. Bun-native routing
2. Compile-time analysis
3. Generated handler pipelines
4. No request-time decorator scanning
5. No request-time dependency discovery
6. Precomputed validation and policy information
7. Static assets through `Bun.file()`
8. Streaming large responses
9. Selective transport loading
10. Removal of development code during bundling

Binary artifacts primarily improve:

- Artifact size
- Startup loading
- Portability
- Metadata parsing

They do not automatically make every HTTP request faster.

---

## 37. Example End-to-End Flow

Source:

```ts
@Graph({
  prefix: "/api",
  controllers: [
    UserController,
  ],
  providers: [
    UserService,
    UserRepository,
  ],
})
class UserGraph {}
```

```ts
@Controller("/users")
class UserController {
  private readonly service =
    inject(UserService);

  @Get("/:id")
  show(request: AppRequest) {
    return this.service.find(
      request.params.id,
    );
  }
}
```

Compile:

```text
Graph prefix       /api
Controller prefix  /users
Route path         /:id
HTTP method        GET
Handler            UserController.show
```

WIR:

```text
Route:
  method ID: 0
  path ID: 1
  controller ID: 2
  handler ID: 3
  flags: body disabled, csrf disabled
```

Generated route:

```ts
const routes = {
  "/api/users/:id": {
    GET: generatedUserShowHandler,
  },
};
```

Runtime:

```ts
Bun.serve({
  routes,
});
```

Request:

```text
GET /api/users/42
        ↓
Bun native router
        ↓
generatedUserShowHandler
        ↓
UserController.show
        ↓
Response
```

---

## 38. Implementation Order

Recommended order:

1. `@warbler/core`
2. `@warbler/config`
3. `@warbler/transport`
4. `@warbler/http`
5. HTTP Playground end-to-end
6. Config discovery integration
7. Minimal compiler for HTTP
8. DI compiler integration
9. `@warbler/websocket`
10. `@warbler/view`
11. `@warbler/runtime`
12. Full `@warbler/compiler`
13. `@warbler/bundler`
14. `@warbler/cli`
15. Binary production artifacts
16. OpenAPI and generated clients
17. Remaining transports

Each package must be complete before the next package is declared production-ready.

---

## 39. Official Bun References

- [Bun documentation](https://bun.com/docs)
- [HTTP server](https://bun.com/docs/runtime/http/server)
- [HTTP routing](https://bun.com/docs/runtime/http/routing)
- [Cookies](https://bun.com/docs/runtime/cookies)
- [CSRF](https://bun.com/docs/runtime/csrf)
- [Bundler plugins](https://bun.com/docs/bundler/plugins)
- [Deep equality](https://bun.com/docs/guides/util/deep-equals)
- [Bun installation](https://bun.com/docs/installation)

---

## 40. Summary

Warbler is intended to be:

```text
Bun-native
Compile-first
Transport-oriented
Security-first
Modular
Strictly typed
Fast at runtime
Easy to understand
```

Its most important architectural rule is:

> The compiler prepares the application; the runtime executes it; Bun handles the native platform work.

The desired production experience is:

```bash
warbler build
bun ./dist/server.js
```

The desired source experience is:

```ts
@Graph({
  prefix: "/api/auth",
  controllers: [
    AuthController,
  ],
  providers: [
    AuthService,
    AuthRepository,
  ],
})
export default class AuthGraph {}
```

```ts
@Controller()
export default class AuthController {
  private readonly service =
    inject(AuthService);

  @Post("/login", { validator: loginValidator })
  login(
    request: AppRequest<typeof loginValidator>,
  ) {
    return JsonRes(
      this.service.login(
        request.body,
      ),
    );
  }
}
```

Warbler should add framework structure and compile-time intelligence without hiding or replacing the Bun capabilities that make the platform fast.
