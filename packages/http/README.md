# @warbler/http

`@warbler/http` is Warbler’s Bun-native HTTP transport. It owns HTTP metadata and contracts, secure request and response primitives, compiled route consumption, static assets, streaming, CSRF, and native server lifecycle.

Normal routes are emitted directly into `Bun.serve({ routes, fetch })`. Bun performs matching and parameter extraction; the fallback handler is reserved for unmatched requests. This package has no custom router or source-code discovery.

Controllers use `Controller` with `Get`, `Post`, `Put`, `Patch`, `Delete`, `Options`, `Head`, or `Sse`. Decorators store immutable compiler metadata and never execute middleware, guards, validation, or policies.

Response helpers return native `Response` values. `FileRes`, `DownloadRes`, `PdfRes`, `ImageRes`, and `ArchiveRes` accept `Bun.file()` or another Blob without buffering it. `HtmlStreamRes` and `SseRes` use pull-based streams and propagate cancellation.

Configuration normalization converts byte limits to safe positive integers, clamps Bun idle timeout to its supported ceiling, applies documented defaults only to omitted values, and deeply freezes the result. Invalid explicit values fail with typed errors.

Static assets are scanned once at startup and inserted into the native route table. Both roots and targets are canonicalized with `realpath`; traversal, encoded traversal, dotfiles, source maps, null bytes, and symlink escapes are rejected according to policy. Unknown extensions use `application/octet-stream` with `nosniff`.

The request pipeline checks framing ambiguity before headers, host, timeout, CSRF, and application execution. CSRF and signed cookies cache imported HMAC keys. Security policies are compiled to route flags and startup-time header templates.

The package intentionally does not implement WebSocket, TCP, UDP, MCP, WebRTC, runtime discovery, compiler source analysis, the template engine itself (owned by `@warbler/view`), persistence, or CLI behavior.

## View rendering and built-ins

`view(name, data, options?)` is the application-facing replacement for calling `@warbler/view`'s `View()` directly. It renders exactly the same way, plus makes five framework built-ins available to every template automatically — no controller needs to pass them:

```ts
import { Controller, Get, view } from "@warbler/http";

@Controller()
export class HomeController {
  @Get("/")
  index() {
    return view("home", { title: "Welcome" });
  }
}
```

```html
{{ tr("auth.login") }}
{{ asset("app.css") }}
{{ route("users.show", user.id) }}
{{{ csrfField }}}
{{ csrfToken }}
```

- **`tr(key, parameters?)`** — reuses the current request's locale/translator (the same one `AppRequest.tr` uses); falls back to returning the key unchanged if the project has no i18n configured.
- **`asset(path)`** — resolves a public/static asset path against the configured static prefix, safely normalized (no `..`/`.` traversal, same normalization the static file server itself uses).
- **`route(name, ...params)`** — resolves a URL from a route's logical `name` (`@Get("/users/:id", { name: "users.show" })`), filling `:param` tokens positionally from `params` and URL-encoding each value. Resolved from a lookup table built once at HTTP transport startup — no scanning per render. Throws a normalized error for an unknown route name or a missing required parameter.
- **`csrfField`** — the complete, trusted, framework-generated hidden `<input>` for the current request's CSRF token, using the configured field name (`http.csrf.fieldName`, default `_csrf`). Intended for raw interpolation: `{{{ csrfField }}}`.
- **`csrfToken`** — the current request's raw CSRF token string. Follows normal escaped interpolation: `{{ csrfToken }}`.

For `{{{ csrfField }}}` to actually verify on submission from a plain `<form>` (no JavaScript), add `"form"` to `http.csrf.sources` — a plain form POST can't set a custom header, so the `"header"` source alone never sees it:

```ts
csrf: { sources: ["header", "form"] } // "json" is also supported, for JSON-bodied requests carrying the same field
```

Verification reads the field from a *clone* of the request body (`Request.clone()`), so the real handler's own body parsing downstream is never disturbed, and rejects any body over 1 MiB by its declared `Content-Length` before reading it at all — the CSRF field itself is always small, regardless of `http.body`'s own configured limits.

These five names (`tr`, `asset`, `route`, `csrfField`, `csrfToken`) are **reserved**: `view("home", { csrfField: "x" })` throws a normalized `ViewReservedVariableError` (`VIEW1004`) instead of silently overriding the built-in.

### Explicit CSRF access

`csrf()` returns the same request's CSRF data as a plain value, for cases where a controller wants to pass it through `view()`'s `data` explicitly (e.g. under an application-chosen key):

```ts
return view("home", {
  security: csrf(), // { field: string; token: string }
});
```

```html
{{{ security.field }}}
{{ security.token }}
```

Both access styles — the automatic `csrfField`/`csrfToken` built-ins and explicit `csrf()` — read the same request-scoped, memoized token. Within one request, `csrf().token === csrfToken` and `csrfField` embeds that same token, always. The token is minted once (lazily, on first access) per request via a synchronous HMAC signature (`node:crypto`) over a fresh random value, and reused for every subsequent access in that request — it is never regenerated mid-request and never shared across concurrent requests (each request gets its own ambient scope, propagated via `AsyncLocalStorage`, mirroring `@warbler/core`'s dependency-injection request scope).

`view()`/`csrf()` may be called from anywhere that runs inside an active HTTP request — controller methods, guards, middleware, and validator `onValidationError` callbacks — without needing an `AppRequest` parameter. Calling either outside of a request throws a clear `ServerStateError`.

### Errors

Every failure that can occur while rendering a view — parsing, compilation, expression evaluation, a failing built-in (`route()`/`asset()`/`tr()`), a missing template, a reserved-name collision, or the final render itself — is caught by `view()` and turned into a `Response`, never a thrown exception or a native Bun error page.

- **Development** (`http.development: true`): `500`, `text/plain; charset=utf-8`, an organized `WARBLER_VIEW_RENDER_ERROR` body built only from the fields the specific error actually carries (template name, line/column when known, the failing expression, and a reason) plus the request's method and path.
- **Production**: `500`, `text/plain; charset=utf-8`, always exactly `Internal Server Error\n\nThe requested view could not be rendered.` — no stack, path, source, or token.

Full details are always logged server-side via the existing console logger, in both modes.

Optional/missing application data is not, by itself, a rendering error — `@if(errors.email) { ... }` renders fine whether or not `errors.email` is set, as long as `errors` itself was passed to `view()`. Only genuinely invalid usage (an undefined variable, an unknown helper call, an unknown route name) fails.
