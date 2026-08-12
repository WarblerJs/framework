# Warbler HTTP Hot-Path Profiling - Phase 1

## Scope

This phase measures the existing production HTTP request path. It does not optimize route dispatch, request context creation, controller dispatch, response handling, security headers, or generated artifacts.

Controlled route:

```ts
@Get("/bench")
bench() {
  return new Response("OK");
}
```

Benchmark command:

```sh
autocannon -c 50 -d 30 http://127.0.0.1:3000/bench
```

## Environment

Measured on `belsrv`, Linux `6.8.0-134-generic`, x86_64.

Bun: `1.3.14`

CPU: Intel Core i7-6700 CPU @ 3.40GHz, 4 cores / 8 threads.

## Historical Baselines

Measured fact from previous controlled runs:

| Target | Req/sec | Avg latency | p99 |
| --- | ---: | ---: | ---: |
| Raw Bun | ~46,322 | ~0.47 ms | ~1 ms |
| Warbler `/bench` with logs | ~11,255 | ~3.98 ms | ~8 ms |
| Warbler `/bench` with production logs disabled | ~21,211 | ~1.78 ms | ~4 ms |

## Phase 1 Benchmarks

Profiling OFF, production logs OFF:

| Metric | Value |
| --- | ---: |
| Req/sec | 21,345.07 |
| Avg latency | 1.74 ms |
| p50 | 2 ms |
| p97.5 | 4 ms |
| p99 | 4 ms |
| Max latency | 24 ms |
| Bytes/sec | 12.9 MB |
| Total requests | 640k in 30.02s |

Profiling ON, production logs OFF:

| Metric | Value |
| --- | ---: |
| Req/sec | 19,499.87 |
| Avg latency | 2.25 ms |
| p50 | 2 ms |
| p97.5 | 4 ms |
| p99 | 5 ms |
| Max latency | 18 ms |
| Bytes/sec | 11.8 MB |
| Total requests | 585k in 30.02s |

Measured profiler overhead:

| Metric | Difference |
| --- | ---: |
| Req/sec drop | 1,845.20 req/sec |
| Req/sec overhead | 8.65% |
| Avg latency increase | 0.51 ms |

Do not present the profiling-on throughput as normal production throughput. It includes timing and aggregation overhead.

## Stage Timings

Aggregate summary emitted after stopping the profiling-enabled server:

| Stage | Count | Avg per invocation | Contribution |
| --- | ---: | ---: | ---: |
| total | 585,012 | 31.94 us | 100.00% |
| requestPreparation | 585,012 | 5.50 us | 17.21% |
| contextPreparation | 1,170,024 | 5.85 us | 36.62% |
| generatedDispatch | 585,012 | 16.73 us | 52.39% |
| routeDispatch | 585,012 | 0.05 us | 0.15% |
| validator | 585,012 | 0.24 us | 0.76% |
| guardMiddleware | 585,012 | 0.05 us | 0.17% |
| requestContext | 1,170,024 | 0.39 us | 2.45% |
| diController | 585,012 | 0.16 us | 0.49% |
| handlerExecution | 585,012 | 1.09 us | 3.40% |
| responseNormalization | 585,012 | 0.03 us | 0.10% |
| securityHeaders | 585,012 | 8.12 us | 25.41% |
| other | 585,012 | 4.23 us | 13.25% |

Observation: `generatedDispatch` is inclusive. It wraps the generated route function and therefore includes generated validation-input preparation plus runtime executor work. Do not add it to the exclusive stages.

Observation: `contextPreparation` is recorded twice per request: once in the HTTP wrapper for `ViewRequestScope`, and once in Runtime for localized request / pipeline input preparation. Its per-request contribution is about `11.70 us`.

Measured fact: exclusive route lookup/dispatch, controller lookup, handler invocation, and response normalization are small for `/bench`.

Measured fact: context preparation and security header application are the largest exclusive measured costs.

## Allocation Observations

Observation: [bun-route-handler.ts](/home/bellib/dev/framework/packages/http/src/native/bun-route-handler.ts:81) allocates and freezes a `ViewRequestScope` object per request. It also creates an `issueCsrfToken` closure and a `cachedToken` binding even when the route returns a plain `Response` and never calls view/CSRF helpers.

Observation: [view-request-scope.ts](/home/bellib/dev/framework/packages/http/src/view/view-request-scope.ts:36) enters `AsyncLocalStorage` for every HTTP request so view helpers can access ambient state across awaits. This is required for routes that use views or CSRF helpers, but `/bench` does not need it.

Observation: [runtime-owner.ts](/home/bellib/dev/framework/packages/runtime/src/lifecycle/runtime-owner.ts:287) allocates a pipeline input wrapper with `Object.freeze` and spread when generated validation input exists. For `/bench`, the generated route still calls `prepareHttpValidationInput(request, 0)`, which returns an empty frozen object.

Observation: [validation-input.ts](/home/bellib/dev/framework/packages/http/src/request/validation-input.ts:6) allocates an object and returns a `Promise` because the function is `async`, even when validator flags are `0`.

Observation: [runtime-owner.ts](/home/bellib/dev/framework/packages/runtime/src/lifecycle/runtime-owner.ts:345) allocates `RequestContextStore` per request. [request-context-store.ts](/home/bellib/dev/framework/packages/core/src/context/request-context-store.ts:36) allocates a null-prototype object, while its pending `Map` stays lazy.

Observation: [runtime-owner.ts](/home/bellib/dev/framework/packages/runtime/src/lifecycle/runtime-owner.ts:346) builds and freezes an `AppRequest` wrapper for every HTTP controller call, including `/bench`, even though the controller method accepts no request parameter.

Observation: [security-headers.ts](/home/bellib/dev/framework/packages/http/src/security/security-headers.ts:31) allocates `new Headers(response.headers)`, iterates `Object.keys(template)`, and returns a new `Response` wrapper per request. This preserves security behavior and avoids mutating user responses, but it is the largest single measured post-handler cost.

Observation: [runtime-owner.ts](/home/bellib/dev/framework/packages/runtime/src/lifecycle/runtime-owner.ts:333) freezes request context values on every request via `RequestContextStore.settle()`, even when no guard or middleware wrote context values.

Observation: [controller-instance-table.ts](/home/bellib/dev/framework/packages/runtime/src/controllers/controller-instance-table.ts:40) controller lookup is a direct indexed array read. The measured `diController` cost is small in this route.

## Cache And Precompute Candidates

Recommendation candidate: request/view context creation should be a compile-time or startup-time decision. Routes that do not use `view()`, `csrf()`, request data, guards, middleware, or request-scoped providers may not need eager view scope, `RequestContextStore`, or `AppRequest` construction.

Recommendation candidate: generated validation input for flags `0` should use a direct binding or compile-time precomputed no-validation path instead of an async empty-object path.

Recommendation candidate: security header application should be investigated as startup-time precomputation plus a native `Response` fast path where safe. Do not reuse mutable `Headers` across requests.

Recommendation candidate: route metadata and handler bindings are already largely startup/compile-time structures. Measurements do not justify prioritizing route lookup or controller lookup first.

Recommendation candidate: immutable transport metadata and security templates are already startup-created. The remaining measured cost is per-response header copying and wrapping.

## Recommended Next Optimization

Recommended isolated branch/commit: `perf/http-lazy-request-context`

Target exactly one area first: request/context creation.

Reason: it is the largest exclusive measured bucket at about `36.62%` of measured framework time and about `11.70 us` per `/bench` request. It also includes several clearly identifiable allocations that `/bench` does not need: `ViewRequestScope`, `AsyncLocalStorage` entry, generated validation-input wrapper, `RequestContextStore`, and `AppRequest`.

Hypothesis: a compiler/startup-selected native `Response` route path for routes with no request parameter, no validator sources, no guards, no middleware, no request-scoped providers, and no view/CSRF usage will reduce context preparation while preserving security headers and error boundaries.

Do not implement this optimization until a separate branch can prove the behavior and benchmark it independently.

## Lazy Request Context Optimization

Implemented follow-up: minimal generated HTTP routes now use a compile/startup-selected fast path.

A route is eligible only when all of these facts are known at compile/startup time:

- handler parameter count is `0`
- no validator is attached
- no guards are attached
- no middleware is attached
- the owning graph has no request-scoped providers
- route flags do not require CSRF, streaming, or view helper context

Eligible routes skip generated validation-input preparation, `AppRequest` construction, `RequestContextStore` creation, and HTTP `ViewRequestScope` / `AsyncLocalStorage` entry. The Bun HTTP wrapper still runs request-smuggling checks, header validation, exception handling, response normalization, and security headers.

Routes with validators, guards, middleware, request parameters, request-scoped providers, `view()`, `csrf()`, or streaming keep the full request-context pipeline.

Measured after implementation, profiling OFF, production logs OFF:

| Metric | Value |
| --- | ---: |
| Req/sec | 33,411.74 |
| Avg latency | 1.08 ms |
| p50 | 1 ms |
| p97.5 | 2 ms |
| p99 | 3 ms |
| Max latency | 20 ms |
| Bytes/sec | 21.1 MB |
| Total requests | 1,002k in 30.02s |

Compared with the Phase 1 profiling-off baseline, `/bench` improved by `12,066.67 req/sec` (`56.54%`) and average latency decreased by `0.66 ms`.

Measured after implementation, profiling ON, production logs OFF:

| Metric | Value |
| --- | ---: |
| Req/sec | 32,170.14 |
| Avg latency | 1.11 ms |
| p50 | 1 ms |
| p97.5 | 2 ms |
| p99 | 3 ms |
| Max latency | 17 ms |
| Bytes/sec | 20.4 MB |
| Total requests | 965k in 30.02s |

Profiler stage summary after stopping the profiling-enabled server:

| Stage | Count | Avg per invocation | Contribution |
| --- | ---: | ---: | ---: |
| total | 965,171 | 15.82 us | 100.00% |
| requestPreparation | 965,171 | 4.63 us | 29.27% |
| contextPreparation | 965,171 | 0.04 us | 0.28% |
| generatedDispatch | 965,171 | 3.62 us | 22.86% |
| routeDispatch | 965,171 | 0.06 us | 0.36% |
| validator | 0 | 0.00 us | 0.00% |
| guardMiddleware | 0 | 0.00 us | 0.00% |
| requestContext | 0 | 0.00 us | 0.00% |
| diController | 965,171 | 0.15 us | 0.92% |
| handlerExecution | 965,171 | 2.36 us | 14.90% |
| responseNormalization | 965,171 | 0.03 us | 0.21% |
| securityHeaders | 965,171 | 6.93 us | 43.78% |
| other | 965,171 | 1.63 us | 10.28% |

Measured fact: after lazy request context, security header application is the largest exclusive measured cost on `/bench`.

## Security Headers Fast-Path Optimization

Implemented follow-up: static security policy is still resolved once at HTTP transport startup, but the template now carries a precompiled immutable header-entry list. The request path applies those entries directly to the native response headers and returns the same response when Bun exposes mutable headers. If a future response type rejects header mutation, Warbler falls back to the previous safe reconstruction path.

Preserved behavior:

- security defaults do not overwrite explicit response headers
- `x-powered-by` is always removed
- response status, statusText, content type, redirect location, cookies, streams, and file bodies are preserved
- response header state remains request-local
- fallback 404 behavior remains unchanged: it still sends its existing `x-content-type-options` header and does not receive the full configured security template

Pre-change benchmark for this task, profiling OFF, production logs OFF:

| Metric | Value |
| --- | ---: |
| Req/sec | 34,317.60 |
| Avg latency | 1.06 ms |
| p50 | 1 ms |
| p97.5 | 2 ms |
| p99 | 3 ms |
| Max latency | 18 ms |
| Bytes/sec | 21.7 MB |
| Total requests | 1,030k in 30.02s |

Post-change benchmark, profiling OFF, production logs OFF:

| Metric | Value |
| --- | ---: |
| Req/sec | 37,037.60 |
| Avg latency | 0.90 ms |
| p50 | 1 ms |
| p97.5 | 2 ms |
| p99 | 2 ms |
| Max latency | 19 ms |
| Bytes/sec | 23.4 MB |
| Total requests | 1,111k in 30.02s |

Measured improvement versus the fresh pre-change run: `+2,720.00 req/sec` (`7.93%`). Average latency decreased by `0.16 ms`; p99 improved from `3 ms` to `2 ms`.

Profiler comparison, profiling ON, production logs OFF:

| Metric | Before | After |
| --- | ---: | ---: |
| Req/sec | 32,102.67 | 36,425.87 |
| Avg latency | 1.11 ms | 0.93 ms |
| p99 | 3 ms | 3 ms |
| Total requests | 963k in 30.02s | 1,093k in 30.02s |
| `securityHeaders` avg | 6.93 us | 4.93 us |
| `securityHeaders` contribution | 43.53% | 37.22% |

Do not compare profiling-on throughput directly with normal production throughput; profiling records timing on every request.

Allocation changes on the common mutable native `Response` path:

- removed per-response `Object.keys(template)` for compiler-created templates
- removed per-response `new Headers(response.headers)`
- removed per-response `new Response(response.body, ...)`
- retained response-local header mutation and fallback reconstruction for immutable headers

Alternatives benchmarked:

- previous copy-and-reconstruct implementation: `34,317.60 req/sec`, `6.93 us` security stage
- compiled tuple plus in-place native response header mutation: `37,037.60 req/sec`, `4.93 us` security stage

Measured fact: after this optimization, `requestPreparation` is the largest exclusive non-security stage on `/bench`. Do not optimize it in the security-header branch.
