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
  defineHandler,
  defineValidator,
  v,
} from "@warblerjs/framework";
```

Exit codes are: `0` success, `1` command/build failure, `2` invalid arguments, `3` invalid project
or configuration, `4` missing dependency, `5` Runtime startup, `6` filesystem, and `7` process.
