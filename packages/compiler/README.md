# @warblerjs/compiler

The Warbler compiler discovers application TypeScript declarations, validates their ownership and
dependency relationships, produces immutable Warbler Intermediate Representation (WIR), and lowers
that WIR into deterministic executable TypeScript artifacts.

```ts
import { compileProject } from "@warblerjs/compiler";

const context = await compileProject(process.cwd());

if (context.diagnostics.some((diagnostic) => diagnostic.category === "error")) {
  // Render diagnostics and stop the build.
}

const wir = context.applicationWIR;
const optimized = context.generatedApplication?.optimized;
```

The compiler creates one TypeScript `Program` and one `TypeChecker`, visits each application source
file once, and resolves Graphs, HTTP and WebSocket controllers, providers, routes, socket events,
and `inject()` dependencies. Validation covers duplicate declarations, ownership, provider
visibility, and dependency cycles. Every failure is represented as a `WARBLER` diagnostic with
source coordinates.

Phase 2 interns strings, assigns stable IDs, folds route paths and policy flags, and emits:

- `generated/tables.generated.ts`
- `generated/routes.generated.ts`
- `generated/socket.generated.ts`
- `generated/providers.generated.ts`
- `generated/application.generated.ts`

Generated route and socket structures use direct object-key lookup. Provider resolution uses dense
provider and dependency tables without decorator or dependency scanning.

This package does not implement Runtime, OpenAPI, binary artifacts, watch mode, hot reload, or an
incremental build cache. It imports no HTTP, WebSocket, runtime, or view package.
