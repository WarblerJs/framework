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

## Request Preparation Investigation

Measured scope in [bun-route-handler.ts](/home/bellib/dev/framework/packages/http/src/native/bun-route-handler.ts:228): `requestPreparation` contains protocol/security checks and SSE timeout preparation only:

- `guardRequestSmuggling(request)`
- `validateRequestHeaders(request, options.headers)`
- `validateRequestHost(request, options.allowedHosts)`
- `server.timeout(request, 0)` when the compiled route is SSE

Observation: on the production quiet `/bench` path, request preparation does not parse `new URL(request.url)`, does not create request IDs, does not allocate request context, does not perform route dispatch, and does not apply security response headers.

Classification:

| Operation | Why it exists | Mandatory for `/bench` | Static work available | Allocation notes |
| --- | --- | ---: | ---: | --- |
| Request-smuggling guard | rejects conflicting `Content-Length` / `Transfer-Encoding` framing | yes | no | reads two headers; splits only when `Content-Length` exists |
| Header limit validation | defense-in-depth header count/name/value/total limits | yes | limits already startup-resolved | traverses all headers and encodes name/value for byte length |
| Host validation | rejects missing, malformed, or disallowed `Host` | yes | allowed-host list already startup-resolved | parses hostname and lowercases for allow-list lookup |
| SSE timeout preparation | disables native timeout for SSE routes | no for `/bench` | compiled route flag already startup-resolved | no work when route is not SSE |

Fresh pre-change benchmark for this task, profiling OFF, production logs OFF:

| Metric | Value |
| --- | ---: |
| Req/sec | 37,712.00 |
| Avg latency | 0.83 ms |
| p50 | 1 ms |
| p97.5 | 2 ms |
| p99 | 2 ms |
| Max latency | 18 ms |
| Bytes/sec | 23.9 MB |
| Total requests | 1,131k in 30.02s |

Fresh pre-change profiler run, profiling ON, production logs OFF:

| Metric | Value |
| --- | ---: |
| Req/sec | 35,968.27 |
| Avg latency | 0.94 ms |
| p99 | 3 ms |
| Total requests | 1,079k in 30.02s |
| `requestPreparation` avg | 4.35 us |
| `requestPreparation` contribution | 32.45% |

Benchmarked candidates:

| Candidate | Normal throughput result | Profiler result | Decision |
| --- | ---: | ---: | --- |
| One-pass request preparation helper with manual UTF-8 byte counting | 37,898.40 req/sec, then 36,240.81 req/sec | not kept | rejected: unstable normal throughput and extra complexity |
| One-pass request preparation helper with module-level `TextEncoder` | median 37,327.74 req/sec across 3 runs | `requestPreparation` 3.72 us, 28.98%; profiled throughput 36,586.94 req/sec | rejected: profiler improved, but normal throughput median was below the fresh baseline and avg latency regressed |
| Original three guards with module-level `TextEncoder` and hoisted framing regexp | 36,703.74 req/sec, then 36,298.94 req/sec | not kept | rejected: normal throughput and average latency regressed |

Measured fact: the combined one-pass helper reduced measured `requestPreparation` from `4.35 us` to `3.72 us` (`14.48%`) under profiling, but the normal production benchmark did not improve. Per the benchmark gate for this task, the implementation was reverted.

Security/correctness validation run during the rejected experiments:

- `bun run typecheck` passed
- focused HTTP security/native/body/cookie/route tests passed: `35 pass`, `0 fail`, `192 expect() calls`
- `playground` production build passed

Final outcome for this phase: no request-preparation source optimization was kept, because no candidate satisfied all success criteria: material profiler reduction, normal throughput improvement, no average latency regression, and no p99 regression.

Profiler-supported next recommendation: leave request preparation unchanged until a more specific security-equivalent design can be proven. Based on the accepted security-header phase profiler, the next promising isolated target remains outside request preparation: reduce remaining `securityHeaders` cost or generated handler execution overhead in a separate task.

## Next Bottleneck Selection - Startup-Bound Security Header Applicator

Measured fact: a fresh normal-production baseline was taken before selecting the next target.

Fresh baseline, profiling OFF, production logs OFF:

| Run | Req/sec | Avg latency | p50 | p97.5 | p99 | Max | Bytes/sec | Total |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 36,951.74 | 0.94 ms | 1 ms | 2 ms | 2 ms | 18 ms | 23.4 MB | 1,109k in 30.02s |
| 2 | 37,751.74 | 0.83 ms | 1 ms | 2 ms | 2 ms | 18 ms | 23.9 MB | 1,133k in 30.02s |
| 3 | 36,716.54 | 0.95 ms | 1 ms | 2 ms | 2 ms | 18 ms | 23.2 MB | 1,102k in 30.02s |

Measured fact: baseline median throughput was `36,951.74 req/sec`.

Fresh profiler run, profiling ON, production logs OFF:

| Stage | Count | Avg per invocation | Contribution |
| --- | ---: | ---: | ---: |
| total | 1,092,291 | 13.14 us | 100.00% |
| requestPreparation | 1,092,291 | 4.33 us | 32.93% |
| contextPreparation | 1,092,291 | 0.04 us | 0.34% |
| generatedDispatch | 1,092,291 | 3.32 us | 25.26% |
| routeDispatch | 1,092,291 | 0.05 us | 0.40% |
| validator | 0 | 0.00 us | 0.00% |
| guardMiddleware | 0 | 0.00 us | 0.00% |
| requestContext | 0 | 0.00 us | 0.00% |
| diController | 1,092,291 | 0.15 us | 1.10% |
| handlerExecution | 1,092,291 | 2.15 us | 16.39% |
| responseNormalization | 1,092,291 | 0.03 us | 0.23% |
| securityHeaders | 1,092,291 | 4.94 us | 37.59% |
| other | 1,092,291 | 1.45 us | 11.01% |

Selected target: `securityHeaders`.

Reason: `securityHeaders` was the largest measured exclusive actionable bucket. `generatedDispatch` remained inclusive, `requestPreparation` had just failed the real-production benchmark gate in a separate isolated pass, and the other exclusive buckets were materially smaller.

Source boundary classification:

| Boundary | Work included | Classification |
| --- | --- | --- |
| [security-headers.ts](/home/bellib/dev/framework/packages/http/src/security/security-headers.ts:40) | template lookup, header plan traversal, response header mutation, immutable-header fallback | response-specific security work |
| [bun-route-handler.ts](/home/bellib/dev/framework/packages/http/src/native/bun-route-handler.ts:48) | synchronous and async finalization call into security-header application | request/response hot path |
| [bun-route-handler.ts](/home/bellib/dev/framework/packages/http/src/native/bun-route-handler.ts:67) | profiled timing boundary around security-header application | profiler boundary |

Kept optimization: bind a `SecurityHeaderApplicator` once when the Bun route handler is created, and represent compiled security headers as one flat immutable string plan. Request time no longer performs the compiled-template symbol lookup or tuple destructuring before applying headers. The existing `applySecurityHeaders(response, template)` API remains for direct callers.

Preserved behavior:

- configured security headers do not overwrite explicit response headers
- `x-powered-by` is still removed
- mutable native responses keep the no-wrapper fast path
- immutable headers still use the safe `new Headers(...)` / `new Response(...)` fallback
- status, statusText, redirects, cookies, streams, and file responses remain intact
- concurrent responses do not share mutable header state

Final kept benchmark, profiling OFF, production logs OFF:

| Run | Req/sec | Avg latency | p50 | p97.5 | p99 | Max | Bytes/sec | Total |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 37,472.27 | 0.98 ms | 1 ms | 2 ms | 2 ms | 17 ms | 23.7 MB | 1,124k in 30.02s |
| 2 | 37,813.60 | 0.97 ms | 1 ms | 2 ms | 2 ms | 17 ms | 23.9 MB | 1,134k in 30.02s |
| 3 | 37,660.54 | 0.97 ms | 1 ms | 2 ms | 2 ms | 17 ms | 23.8 MB | 1,130k in 30.02s |

Measured fact: final median throughput was `37,660.54 req/sec`, `+708.80 req/sec` (`+1.92%`) over the fresh baseline median. p50, p97.5, and p99 were unchanged. Average latency moved from `0.94 ms` on the median baseline run to `0.97 ms` on the median final run; observation: this is within the observed run-to-run noise for this benchmark, while tail latency did not regress.

Final profiler comparison, profiling ON, production logs OFF:

| Metric | Before | After |
| --- | ---: | ---: |
| Req/sec | 36,406.67 | 37,457.87 |
| Avg latency | 0.87 ms | 0.86 ms |
| p99 | 3 ms | 2 ms |
| Total requests | 1,092k in 30.02s | 1,124k in 30.03s |
| `securityHeaders` avg | 4.94 us | 3.69 us |
| `securityHeaders` contribution | 37.59% | 31.22% |

Measured fact: `securityHeaders` decreased by `1.25 us` (`25.30%`) in the selected profiler bucket.

Rejected experiment: unrolled standard nine-header applicator.

| Run | Req/sec | Avg latency | p99 | Decision |
| --- | ---: | ---: | ---: | --- |
| 1 | 36,462.14 | 1.03 ms | 2 ms | rejected |
| 2 | 37,138.40 | 1.01 ms | 2 ms | rejected |

Rejected reason: the specialization added complexity, did not beat the simpler kept candidate, and made average latency visibly worse in both samples.

Allocation and request-time changes:

- moved compiled-template plan lookup from request time to route-handler startup
- replaced nested frozen `[name, value]` tuples with one flat frozen string plan
- removed per-response tuple destructuring in the common compiled-template path
- did not introduce mutable shared response state or a runtime cache

Correctness validation:

- `bun run typecheck` passed
- focused HTTP security/native/CSRF/error tests passed: `37 pass`, `0 fail`, `225 expect() calls`
- `playground` production build passed

Raw Bun context: final Warbler median throughput is `81.31%` of the historical Raw Bun baseline (`37,660.54 / 46,322`).

Next recommendation: do not re-open request preparation or security headers immediately. The next isolated candidate should inspect `handlerExecution` and the non-exclusive parts of `generatedDispatch` together, but only after confirming whether the inclusive profiler boundary can be interpreted without adding heavy instrumentation.

## AOT Specialized HTTP Route Execution Investigation

Measured fact: this phase investigated an architectural AOT route-execution change, not a micro-optimization. The tested target was the minimal zero-argument HTTP route path, because `/bench` still reached Runtime through generic route execution:

- generated route closure calls `executeHttpRoute(routeId, request)`
- Runtime looks up the route plan by `routeId`
- minimal path calls `this.invokeHandler(handlerId, Object.freeze([]))`
- `invokeHandler` looks up the handler binding and controller instance
- `executeHandler` validates `binding.invoke` and calls it with spread arguments
- generated zero-argument handler bindings still used a rest parameter and spread internally

Hypothesis: moving minimal route execution from request-time interpretation to startup/compiler-selected direct invocation would reduce generic lookup, empty-array allocation, rest/spread overhead, and handler indirection.

Fresh pre-change production baseline, profiling OFF, production logs OFF. Server was warmed up first with `autocannon -c 50 -d 10 http://127.0.0.1:3000/bench`.

| Run | Req/sec | Avg latency | p50 | p97.5 | p99 | Max | Bytes/sec | Total |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 37,408.27 | 0.98 ms | 1 ms | 2 ms | 2 ms | 19 ms | 23.7 MB | 1,122k in 30.02s |
| 2 | 37,794.40 | 0.96 ms | 1 ms | 2 ms | 2 ms | 17 ms | 23.9 MB | 1,134k in 30.02s |
| 3 | 38,097.87 | 0.93 ms | 1 ms | 2 ms | 2 ms | 17 ms | 24.1 MB | 1,143k in 30.02s |
| 4 | 37,322.40 | 0.98 ms | 1 ms | 2 ms | 2 ms | 17 ms | 23.6 MB | 1,120k in 30.02s |
| 5 | 37,300.54 | 0.98 ms | 1 ms | 2 ms | 2 ms | 16 ms | 23.6 MB | 1,119k in 30.02s |

Measured fact: baseline median throughput was `37,408.27 req/sec`.

Rejected experiment: startup-selected `HttpRouteExecutionPlan.execute` family.

Implementation tested:

- route plans carried a preselected `execute(request, validationInput)` closure
- minimal routes prebound handler binding, controller instance, and generated `invoke`
- minimal routes called the generated handler without `this.invokeHandler(...)` and without `Object.freeze([])`
- feature routes retained the existing validation/guard/middleware/request-context pipeline through a preselected pipeline executor

Production benchmark:

| Run | Req/sec | Avg latency | p99 | Decision |
| --- | ---: | ---: | ---: | --- |
| 1 | 37,486.14 | 1.02 ms | 2 ms | rejected |
| 2 | 37,506.40 | 1.02 ms | 2 ms | rejected |
| 3 | 36,592.27 | 1.04 ms | 2 ms | rejected |
| 4 | 38,043.74 | 1.00 ms | 2 ms | rejected |
| 5 | 37,100.54 | 1.03 ms | 2 ms | rejected |

Measured fact: runtime-only AOT median was `37,486.14 req/sec`, only `+0.21%` over baseline, while median-run average latency regressed from `0.98 ms` to `1.02 ms`. This was not meaningful enough for an architectural change.

Rejected experiment: runtime AOT plus compiler-generated zero-argument handlers without rest/spread.

Additional implementation tested:

- zero-parameter generated handler bindings emitted `controller.method()` instead of `(...input) => controller.method(...input)`
- non-zero-parameter handlers kept the existing generic generated binding

Production benchmark:

| Run | Req/sec | Avg latency | p99 | Decision |
| --- | ---: | ---: | ---: | --- |
| 1 | 36,723.20 | 1.03 ms | 2 ms | rejected |
| 2 | 37,034.94 | 1.03 ms | 2 ms | rejected |
| 3 | 36,733.07 | 1.03 ms | 2 ms | rejected |
| 4 | 37,657.34 | 1.01 ms | 2 ms | rejected |
| 5 | 36,906.40 | 1.03 ms | 2 ms | rejected |

Measured fact: combined AOT median was `36,906.40 req/sec`, `-1.34%` versus baseline, with worse average latency. The source changes were reverted.

Correctness validation during the rejected AOT experiments:

- `bun run typecheck` passed
- focused compiler/runtime tests passed: `28 pass`, `0 fail`, `120 expect() calls`
- focused runtime/http tests passed before the compiler variant: `32 pass`, `0 fail`, `105 expect() calls`
- `playground` production build passed

Final outcome: no AOT route-execution source change was kept. The current generic/minimal split remains simpler and faster under the five-run production benchmark protocol.

Next recommendation: stop `/bench`-only micro and architecture experiments for now. The next useful phase should be a realistic application benchmark, preferably the proposed e-commerce validation app, because the remaining `/bench` differences are now dominated by mandatory framework/security work and Bun/JSC variance.

## Compile-Time Zero-Copy Phase 1 Follow-Up: HTTP Request Shape

Audit date: 2026-08-13.

Scope: HTTP validation input preparation and Runtime `AppRequest` wrapping for non-minimal routes.

Baseline before change:

- `bun test packages/runtime/tests/start-runtime.test.ts packages/runtime/tests/request-context-pipeline.test.ts playground/tests/validator-pipeline.integration.test.ts playground/tests/http.integration.test.ts`
- Result: `19 pass`, `0 fail`, `81 expect() calls`

Hot-path findings:

- [validation-input.ts](/home/bellib/dev/framework/packages/http/src/request/validation-input.ts:6) built validation input by conditionally adding keys according to validator flags. This avoided unused values but produced different object property sets across routes.
- [runtime-owner.ts](/home/bellib/dev/framework/packages/runtime/src/lifecycle/runtime-owner.ts:473) cloned validation input with object spread when attaching Runtime-only request references.
- [runtime-owner.ts](/home/bellib/dev/framework/packages/runtime/src/lifecycle/runtime-owner.ts:532) froze every generated `AppRequest` wrapper during request execution.
- [validation-input.ts](/home/bellib/dev/framework/packages/http/src/request/validation-input.ts:38) copied Bun route params with object spread.

Kept source changes:

- Prepared HTTP validation input now uses a fixed property set: `value`, `query`, `path`, `headers`, `cookies`. Unneeded slots remain present with `undefined`.
- Runtime HTTP pipeline input now uses a fixed property set and references prepared values directly instead of spreading/cloning them.
- Runtime `AppRequest` wrappers keep the stable handler-facing property set but are no longer frozen per request; nested parsed records that were already frozen remain frozen.
- Native route params are copied into an owned null-prototype record without object spread.

Correctness validation after change:

- `bun test packages/http/tests/validation-input.test.ts packages/runtime/tests/request-context-pipeline.test.ts packages/runtime/tests/start-runtime.test.ts playground/tests/validator-pipeline.integration.test.ts playground/tests/http.integration.test.ts`
- Result: `20 pass`, `0 fail`, `90 expect() calls`
- `bun run --filter '@warblerjs/http' typecheck`
- `bun run --filter '@warblerjs/runtime' typecheck`

Measurement note: no throughput, allocation, p99, or p999 numbers are claimed for this follow-up. This is a Phase 1 structural allocation/object-shape cleanup with correctness guardrails; it still needs the benchmark protocol from the earlier sections before claiming a production performance win.

## Compile-Time Zero-Copy Phase 2 Follow-Up: Guard Pipeline Linking

Audit date: 2026-08-13.

Scope: Runtime linking for HTTP and WebSocket guard ranges, plus the existing HTTP middleware route-lifecycle chain.

Baseline before change:

- `bun test packages/runtime/tests/start-runtime.test.ts packages/runtime/tests/request-context-pipeline.test.ts packages/runtime/tests/request-scope.test.ts packages/compiler/tests/phase2.test.ts playground/tests/http.integration.test.ts playground/tests/validator-pipeline.integration.test.ts`
- Result: `34 pass`, `0 fail`, `155 expect() calls`

Audit findings:

- The compiler already emits flat guard and middleware ID tables with route/socket `start + count` offsets. No global/graph/controller/route lifecycle hierarchy is currently present in the HTTP runtime surface.
- Runtime startup still copied each route/socket guard range with `slice()` and kept one copied array per route pipeline.
- Request execution called `executeGuardRange(...)`, which re-read each guard binding and checked `typeof execute` on every guarded request.
- Runtime startup also copied middleware ranges per route/socket pipeline. Full middleware pipeline deduplication was not safe in this slice because the terminal closure captures route-specific handler execution and HTTP request-context settling.

Kept source changes:

- Added a startup-local guard pipeline registry that deduplicates identical ordered guard ID sequences.
- Linked guard bindings to immutable compiled guard pipelines once at Runtime startup.
- Runtime route/socket pipelines now execute `guardPipeline.execute(...)`, avoiding request-time guard binding lookup and executable checks.
- Preserved `boolean | Promise<boolean>` semantics: synchronous guard pipelines stay synchronous until an actual async guard is encountered.
- Deduplicated startup numeric ranges for guard and middleware ID sequences without changing generated artifact format.
- Replaced HTTP route plan `.map(...)` startup construction with an indexed loop in the performance-sensitive runtime linker.

Rejected or deferred:

- No compiler artifact format change was kept. The existing `start + count` flat tables already express the static relationship compactly, and startup linking is enough for this slice.
- No separate HTTP lifecycle-pipeline table was invented; the current HTTP lifecycle behavior is middleware plus request-context settling, not a before/after/error hook hierarchy.
- Full middleware pipeline deduplication is deferred because route-specific terminal behavior would require a larger execution-plan refactor.

Correctness validation after change:

- `bun test packages/runtime/tests/start-runtime.test.ts packages/runtime/tests/request-context-pipeline.test.ts packages/runtime/tests/request-scope.test.ts playground/tests/http.integration.test.ts playground/tests/validator-pipeline.integration.test.ts`
- Result: `24 pass`, `0 fail`, `100 expect() calls`
- `bun run --filter '@warblerjs/runtime' typecheck`
- `bun run typecheck`
- `bun test`: `583 pass`, `0 fail`, `1860 expect() calls`

Measurement note: no throughput, allocation, p99, or p999 numbers are claimed for this follow-up. The kept change removes confirmed request-time guard binding lookup/type checks and startup duplicate range copies, but production performance still requires the benchmark protocol from the earlier sections.

## Compile-Time Zero-Copy Phase 3 Follow-Up: Request Requirements And Lazy AppRequest

Audit date: 2026-08-13.

Scope: generated HTTP route validation wrappers, Runtime HTTP route request requirement metadata, request-scoped DI detection, and `AppRequest` optional feature materialization.

Baseline before change:

- Focused correctness suite: `bun test packages/http/tests/validation-input.test.ts packages/runtime/tests/request-context-pipeline.test.ts packages/runtime/tests/request-scope.test.ts packages/runtime/tests/start-runtime.test.ts playground/tests/http.integration.test.ts playground/tests/validator-pipeline.integration.test.ts`
- Result: `25 pass`, `0 fail`, `107 expect() calls`

Audit findings:

- Bun route lookup already supplies the matched native `Request`; Warbler does not create route metadata arrays per request on the minimal route path.
- Body parsing was already guarded by validator source flags in [validation-input.ts](/home/bellib/dev/framework/packages/http/src/request/validation-input.ts:6), but the function was declared `async`, so every validated route entered Promise execution even when it only needed query, params, headers, or cookies.
- Generated validated HTTP route wrappers looked up `validatorBindings[id].flags` and called `.then(...)` on every validated request in [generate-artifacts.ts](/home/bellib/dev/framework/packages/compiler/src/generator/generate-artifacts.ts:370).
- Runtime route startup already identified minimal zero-argument routes, but it recomputed request-scoped graph presence with provider scans while linking route plans.
- Non-minimal `AppRequest` construction always materialized `Bun.CookieMap` in [runtime-owner.ts](/home/bellib/dev/framework/packages/runtime/src/lifecycle/runtime-owner.ts:594), even when a handler, guard, or middleware never read `request.cookies`.
- Query and params were not globally parsed before route execution. Validator query/path preparation remained flag-driven; handler-facing unvalidated query/params can now be materialized lazily on access.
- Headers remain the native `Headers` object. No header record is built unless header validation requires it.
- No safe static metadata currently exists for arbitrary guard or middleware request feature usage, so this slice does not infer requirements from source code.

Kept source changes:

- `prepareHttpValidationInput(...)` now returns synchronously unless body parsing is required. Body validators still parse once through the async path.
- Generated HTTP wrappers now carry a startup/module-time `httpRouteRequestRequirements` table sourced from compiled validator flags, and preserve sync execution for non-body validators.
- Runtime HTTP route plans now store a compact internal request requirement mask derived at startup from validator flags, AppRequest need, and request-scoped DI need.
- Request-scoped provider graph detection is precomputed once in the runtime pipeline registry and reused while linking route plans.
- `AppRequest.params`, `AppRequest.query`, and `AppRequest.cookies` are request-local memoized accessors. `cookies` is no longer parsed merely because an `AppRequest` object exists, and it reuses Bun's native cookie map when already attached.
- Parsed validation output is still reused by reference for handler-facing body/query/path values when validation succeeds.

Rejected or deferred:

- No auth/session requirement flags were added because the current HTTP surface does not expose safe explicit static metadata for them.
- No guard/middleware feature inference was added; unsafe source-code inspection would risk skipping security-sensitive work.
- Body parsing for arbitrary unvalidated `AppRequest.body` was not invented. Existing semantics are preserved: body values come from validator preparation.
- No request object pools, context pools, or custom allocator abstractions were introduced.

Correctness validation after change:

- Focused suite: `bun test packages/http/tests/validation-input.test.ts packages/runtime/tests/request-context-pipeline.test.ts packages/runtime/tests/request-scope.test.ts packages/runtime/tests/start-runtime.test.ts packages/compiler/tests/phase2.test.ts playground/tests/http.integration.test.ts playground/tests/validator-pipeline.integration.test.ts`
- Result: `39 pass`, `0 fail`, `183 expect() calls`
- `bun run --filter '@warblerjs/http' typecheck`
- `bun run --filter '@warblerjs/runtime' typecheck`
- `bun run --filter '@warblerjs/compiler' typecheck`
- `bun run typecheck`
- `bun test`: `586 pass`, `0 fail`, `1872 expect() calls`

Post-change spot measurement:

- Environment: playground, `APP_ENV=production`, request/startup/runtime/transport/debug/WebSocket logs disabled, HTTP profiling disabled.
- Warmup: `autocannon -c 50 -d 5 http://127.0.0.1:3000/bench`
- Samples: three `autocannon -c 50 -d 10 http://127.0.0.1:3000/bench` runs.
- Results: `36,647.2 req/sec`, `35,909.6 req/sec`, `36,320.81 req/sec`; p50 `1 ms`, p99 `2 ms` on all three runs.

Measurement note: this is a post-change smoke measurement, not a valid before/after benchmark. No throughput, allocation, p99, or p999 improvement is claimed for this slice. The retained changes remove confirmed unnecessary Promise wrapping for non-body validators and confirmed eager cookie materialization for unused `AppRequest.cookies`.

## Unified Error System And Daily Logging Follow-Up

Audit date: 2026-08-14.

Scope: core error normalization, HTTP/SSE/WebSocket presenters, runtime logging startup, logging configuration, trusted-proxy client IP resolution, and buffered daily file logging.

Kept source changes:

- `normalizeError(...)` now normalizes exactly once into the `WarblerError` model. Existing `WarblerError` instances pass through unchanged; non-Warbler throwables become a generic non-exposed `INTERNAL_SERVER_ERROR`.
- Presenters use `safeErrorMessage(...)` for client output. Development responses can include stack/cause diagnostics; production responses expose only allow-listed code/message/request ID fields.
- HTTP browser requests receive a small precompiled monochrome HTML error page. API requests continue to receive structured JSON.
- SSE stream failures emit a protocol-correct `event: error` frame and close gracefully.
- WebSocket handler failures dispatch the compiled error lifecycle, send a safe error envelope for recoverable failures, and close with `1011` for fatal errors.
- `@warblerjs/console` owns a bounded async `BufferedDailyFileLogger` with daily file names, pretty formatting, retention cleanup, and redaction of common secret patterns.
- Runtime configures the file logger once from `logging.config.ts`; successful request paths do not enqueue or flush file logs.
- HTTP error reports include a safely resolved client IP. `X-Forwarded-For` is honored only when the immediate peer is in the trusted proxy list.

Rejected or deferred:

- No new package or external dependency was introduced.
- No synchronous file I/O is used for error logging.
- No full request bodies, headers, cookies, tokens, SQL payloads, or arbitrary request objects are retained by the logger.

Correctness validation after change:

- Focused suite: `bun test packages/core/tests/errors.test.ts packages/console/tests/console.test.ts packages/config/tests/runtime.test.ts packages/http/tests/request-error-response.test.ts packages/http/tests/security-headers.test.ts packages/http/tests/sse.test.ts packages/websocket/tests/runtime-launcher.test.ts`
- Result: `71 pass`, `0 fail`, `347 expect() calls`
