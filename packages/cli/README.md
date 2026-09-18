# @warblerjs/cli

Bun-native orchestration for Warbler projects.

```text
warbler dev
warbler build
warbler start
warbler doctor
warbler inspect [section]
warbler new <name>
warbler make:graph <name> [-a <architecture>] [-t <transport[,transport]>]
warbler db:pg migration [<kind>:<name>] [--no-soft-delete]
warbler db:pg rollback [--step 3]
warbler db:pg generate
warbler db:pg migrate:fresh [--seed]
warbler db:pg seed:make <name>
warbler db:pg seed:run [--only <name>]
warbler clean
warbler version
warbler help
```

The CLI locates and validates applications, delegates configuration to `@warblerjs/config`, analysis
and generation to `@warblerjs/compiler`, and execution to a Runtime launcher abstraction. It never
analyzes TypeScript, reconstructs dependency injection, scans decorators, or fabricates executable
handler bindings.

Development uses one managed recursive watcher, coalesces change bursts, preserves the last valid
Runtime after compilation errors, and writes development data beneath `.warbler/`. Production
builds bundle the real application entry with `Bun.build`; `start` runs that existing build without
compiling.

All generators enforce project boundaries, reject traversal and symlink output, and avoid
overwriting unless `--force` is explicit. `clean` can remove only `dist/` and `.warbler/`.

## Starter Versions

`warbler new <name>` gets Warbler dependency versions from
`src/new/starter-package-versions.generated.ts`. That file is generated from the reviewed
`starter-compatibility.json` catalog, whose explicit allowlist is: `config`, `crypto`, `database`,
`email`, `framework`, `frontend`, `http`, `i18n`, `runtime`, `view`, and `websocket`.

Release automation updates `starter-compatibility.json` only after the corresponding package
versions have been published successfully to npm. Local workspace package versions are validated
only for package existence and name alignment; they are not the authority for installable starter
dependencies.

Regenerate after updating the catalog:

```sh
bun run generate:cli-starter-versions
```

CI and release automation should verify the committed file before packing the CLI:

```sh
bun run check:cli-starter-versions
```

Stable package versions are emitted as caret ranges, for example `0.1.0` becomes `^0.1.0`.
Prerelease versions are emitted exactly, so `0.1.0-rc.0` does not float to an incompatible
prerelease. The starter must never emit `workspace:*`.

The installed CLI cannot read sibling workspace manifests because those files do not exist outside
the monorepo. Runtime starter generation therefore imports only the static generated manifest
published inside `@warblerjs/cli`; the development generator script is not needed by end users.

## Starter Configs

`warbler new <name>` gets every `src/config/**/*.ts` starter file and its public `.env.example`
from `src/new/starter-configs.generated.ts`. That file is generated from the reviewed
`playground/src/config/**` tree and `playground/.env.example`, preserving source text except
normalized line endings and a final newline. The installed CLI imports only the static generated
snapshot; it never scans the Playground workspace.

Regenerate after reviewing Playground config changes:

```sh
bun run generate:cli-starter-configs
```

Verify the committed snapshot before packing or publishing:

```sh
bun run check:cli-starter-configs
```

The config generator also statically checks supported `@warblerjs/config` environment helper calls
against `playground/.env.example`. Dynamic environment-key expressions are rejected instead of
being silently skipped. Starter `.env` files are derived from the generated `.env.example` snapshot
with local host, project database name, and fresh 32-byte base64url development secrets applied at
project creation time.

## Graph Generation

`warbler make:graph <name>` is the architecture-aware generation boundary. It generates a
feature Graph under `src/graphs/<name>/` and uses `@warblerjs/framework` for application-facing
imports.

```text
warbler make:graph users
warbler make:graph users -a hexagonal
warbler make:graph chat -t socket
warbler make:graph realtime -a hexagonal -t http,socket
```

Options:

- `-a, --architecture <architecture>`: `minimal`, `hexagonal`, `clean`, or `mvc`.
- `-t, --transport <transport[,transport]>`: `http`, `socket`, or a comma-separated list.

The default architecture is `minimal`. The default transport is `http`, so
`warbler make:graph users` generates a minimal HTTP Graph.

Generated presentation code is transport-aware:

```text
presentation/
└── http/
    ├── handlers/
    ├── validation/
    ├── guards/
    └── middleware/
```

Application templates import stable public APIs from the façade:

```ts
import {
  defineHttpGraph,
  defineValidator,
  v,
} from "@warblerjs/framework";
```

Exit codes are: `0` success, `1` command/build failure, `2` invalid arguments, `3` invalid project
or configuration, `4` missing dependency, `5` Runtime startup, `6` filesystem, and `7` process.
