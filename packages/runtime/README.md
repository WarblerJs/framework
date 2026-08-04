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
