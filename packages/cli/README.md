# @warbler/cli

Bun-native orchestration for Warbler projects.

```text
warbler dev
warbler build
warbler start
warbler doctor
warbler inspect [section]
warbler new <name>
warbler generate <kind> <name>
warbler db:pg migration [<kind>:<name>]
warbler db:pg rollback [--step 3]
warbler db:pg generate
warbler db:pg reset --force [--seed]
warbler db:pg seed [<name>]
warbler clean
warbler version
warbler help
```

The CLI locates and validates applications, delegates configuration to `@warbler/config`, analysis
and generation to `@warbler/compiler`, and execution to a Runtime launcher abstraction. It never
analyzes TypeScript, reconstructs dependency injection, scans decorators, or fabricates executable
handler bindings.

Development uses one managed recursive watcher, coalesces change bursts, preserves the last valid
Runtime after compilation errors, and writes development data beneath `.warbler/`. Production
builds bundle the real application entry with `Bun.build`; `start` runs that existing build without
compiling.

All generators enforce project boundaries, reject traversal and symlink output, and avoid
overwriting unless `--force` is explicit. `clean` can remove only `dist/` and `.warbler/`.

Exit codes are: `0` success, `1` command/build failure, `2` invalid arguments, `3` invalid project
or configuration, `4` missing dependency, `5` Runtime startup, `6` filesystem, and `7` process.
