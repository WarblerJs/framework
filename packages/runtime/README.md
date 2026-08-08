# @warbler/runtime

Warbler Runtime is the small production bootstrap layer for compiler-generated artifacts. It loads
one explicitly supplied generated application module, creates isolated root and Graph provider
containers, loads normalized configuration, lazily imports enabled transports, and owns graceful
shutdown.

```ts
const runtime = await bootstrapApplication({
  generated: () => import("./generated/application.generated"),
  providerFactories,
  routeHandlers,
  socketHandlers,
  transportLoaders: {
    http: () => import("./http-adapter").then(({ adapter }) => adapter),
    websocket: () => import("./websocket-adapter").then(({ adapter }) => adapter),
  },
});
```

Disabled transport loaders and transport configurations are never touched. Resolution uses
compiler-generated numeric provider and dependency tables with Graph-to-root fallback; it does not
inspect classes, decorators, metadata, source files, or TypeScript.

Lifecycle is `created → bootstrapping → running → stopping → stopped`. `SIGINT` and `SIGTERM`
initiate reverse-order transport shutdown and explicit provider disposal. Runtime does not compile
applications, discover routes/events, implement transports, or generate artifacts.

## Fatal errors

Ordinary application errors (a controller/handler/socket-event throwing) never reach this
package — they're caught and rendered by each transport's own exception boundary
(`@warbler/http`, `@warbler/websocket`). `installFatalErrorHandlers(runtime)` is a separate,
opt-in last resort for a genuinely fatal failure that escapes every one of those — it logs,
gracefully calls the Runtime's existing `stop()`, then exits the process non-zero:

```ts
const runtime = await startRuntime({ application, runtimeConfig, transportLaunchers });
installFatalErrorHandlers(runtime);
```

It is **not** installed automatically by `startRuntime`/`GeneratedRuntimeOwner` — that class is
also constructed directly by tests in-process, where a real `process.exit()` on any unrelated
failure would be unacceptable. Only the CLI's generated production entrypoint calls it, since
that's the one place a real, standalone process is actually running the application.
