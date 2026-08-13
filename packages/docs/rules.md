# Warbler Performance Architecture — New Rules

## Core Philosophy

* [ ] Functional programming only.
* [ ] Prefer pure functions for public/compiler APIs.
* [ ] Allow controlled local mutation internally when it prevents unnecessary allocations.
* [ ] Runtime compiled structures must be immutable.
* [ ] Optimize for **minimal allocation**, not theoretical zero allocation.
* [ ] Never sacrifice correctness for micro-optimizations.

## Compiler

* [ ] Move structural work to compile time whenever possible.
* [ ] Normalize metadata once.
* [ ] Resolve lifecycle composition at compile time.
* [ ] Resolve DI graphs at compile time.
* [ ] Compile validators before runtime.
* [ ] Compile route execution pipelines before runtime.
* [ ] Intern reusable schemas, guards, validators, hooks, handlers, and providers.
* [ ] Deduplicate identical pipelines.
* [ ] Prefer compact IDs/references over duplicated objects.
* [ ] Prefer flat tables over deeply nested object graphs.
* [ ] Finalize and freeze the compiled runtime blueprint.

## Runtime Hot Path

* [ ] No object spread (`{ ...x }`) in hot paths.
* [ ] No array spread (`[...x]`) in hot paths.
* [ ] Avoid `concat()` in hot paths.
* [ ] Avoid `map()` in performance-sensitive internals.
* [ ] Avoid `filter()` in performance-sensitive internals.
* [ ] Avoid `reduce()` in performance-sensitive internals.
* [ ] Avoid `forEach()` in performance-sensitive internals.
* [ ] Prefer indexed `for` loops for hot iterations.
* [ ] Avoid temporary arrays and objects.
* [ ] No lifecycle merging per request.
* [ ] No schema compilation per request.
* [ ] No DI graph resolution per request.
* [ ] No unnecessary structural composition per request.
* [ ] Prefer direct numeric/table lookups where beneficial.

## Request Lifecycle

* [ ] Keep request context minimal.
* [ ] Create request data only when required.
* [ ] Parse body lazily.
* [ ] Parse query lazily when possible.
* [ ] Parse cookies lazily.
* [ ] Create session state only when required.
* [ ] Create request-scoped DI only when required.
* [ ] Never store per-request mutable state globally.
* [ ] Remove persistent references to request state when the request completes.
* [ ] Let GC reclaim unreachable per-request objects naturally.

## References & Reuse

* [ ] Reuse application-lifetime immutable structures.
* [ ] Share immutable schemas and metadata safely.
* [ ] Reference shared structures by IDs where practical.
* [ ] Never mutate shared runtime structures.
* [ ] Never reuse mutable request state between concurrent requests.
* [ ] Avoid defensive copying unless mutation safety actually requires it.

## Event Loop

* [ ] Never block the event loop with unnecessary CPU work.
* [ ] Move compilation, normalization, linking, and optimization outside request handling.
* [ ] Keep the request path focused on lookup → execute → I/O → respond.
* [ ] Avoid synchronous CPU-heavy operations inside handlers.
* [ ] Preserve Bun's asynchronous I/O model.
* [ ] Do not introduce unnecessary microtasks.

## Promise / Async

* [ ] Do not mark functions `async` unnecessarily.
* [ ] Do not wrap synchronous results in `Promise`.
* [ ] Avoid unnecessary `await`.
* [ ] Preserve synchronous fast paths.
* [ ] Generate/use asynchronous paths only when actual asynchronous work exists.
* [ ] Support `T | Promise<T>` where framework contracts need both modes.

## Execution Pipelines

* [ ] Compile execution order ahead of runtime.
* [ ] Represent reusable pipelines once.
* [ ] Routes should reference pipeline IDs rather than duplicate pipeline arrays.
* [ ] Specialize pipelines when compile-time information allows it.
* [ ] Skip unused framework features entirely.
* [ ] Avoid generic runtime dispatch when a direct compiled path is available.

## Memory

* [ ] Minimize allocation on the request hot path.
* [ ] Reuse immutable application-lifetime data.
* [ ] Avoid retaining completed request objects.
* [ ] Avoid accidental closure retention of request context.
* [ ] Avoid unbounded global caches.
* [ ] Bound caches explicitly when caching is necessary.
* [ ] Treat unnecessary allocation as a performance issue.
* [ ] Treat retained request references as a correctness issue.

## Performance Rule

> **Allocate at compile time. Reference at runtime. Allocate per request only when required. Release request references after completion.**

## Runtime Goal

> **No unnecessary allocation, copying, merging, compilation, or graph resolution on the request hot path.**
