# @warbler/http

`@warbler/http` is Warbler’s Bun-native HTTP transport. It owns HTTP metadata and contracts, secure request and response primitives, compiled route consumption, static assets, streaming, CSRF, and native server lifecycle.

Normal routes are emitted directly into `Bun.serve({ routes, fetch })`. Bun performs matching and parameter extraction; the fallback handler is reserved for unmatched requests. This package has no custom router or source-code discovery.

Controllers use `Controller` with `Get`, `Post`, `Put`, `Patch`, `Delete`, `Options`, `Head`, or `Sse`. Decorators store immutable compiler metadata and never execute middleware, guards, validation, or policies.

Response helpers return native `Response` values. `FileRes`, `DownloadRes`, `PdfRes`, `ImageRes`, and `ArchiveRes` accept `Bun.file()` or another Blob without buffering it. `HtmlStreamRes` and `SseRes` use pull-based streams and propagate cancellation.

Configuration normalization converts byte limits to safe positive integers, clamps Bun idle timeout to its supported ceiling, applies documented defaults only to omitted values, and deeply freezes the result. Invalid explicit values fail with typed errors.

Static assets are scanned once at startup and inserted into the native route table. Both roots and targets are canonicalized with `realpath`; traversal, encoded traversal, dotfiles, source maps, null bytes, and symlink escapes are rejected according to policy. Unknown extensions use `application/octet-stream` with `nosniff`.

The request pipeline checks framing ambiguity before headers, host, timeout, CSRF, and application execution. CSRF and signed cookies cache imported HMAC keys. Security policies are compiled to route flags and startup-time header templates.

The package intentionally does not implement WebSocket, TCP, UDP, MCP, WebRTC, runtime discovery, compiler source analysis, views, persistence, or CLI behavior.
