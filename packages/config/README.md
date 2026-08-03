# @warbler/config

`@warbler/config` discovers, loads, validates, normalizes, and freezes Warbler configuration for Bun.

The loader follows the Warbler workspace convention:

- `playground/src/config/runtime.config.ts`
- `playground/src/config/transports/http.config.ts`
- `playground/src/config/transports/ws.config.ts`
- `playground/src/config/transports/tcp.config.ts`
- `playground/src/config/transports/udp.config.ts`
- `playground/src/config/transports/mcp.config.ts`
- `playground/src/config/transports/webrtc.config.ts`

Transport modules are discovered and imported only when their runtime activation is enabled. Invalid and missing values fail immediately with `ConfigError`; values are never silently defaulted or discarded.

The main entry point exposes runtime loading and validation plus the core byte-size, duration, port, host, and boolean parsers. Discovery, parser, validator, normalization, type, and error subpath exports provide the package's focused APIs.

Byte sizes accept canonical lowercase integer values with `b`, `kb`, `mb`, or `gb`. Durations accept canonical lowercase integer values with `ms`, `s`, `m`, or `h`. Ports are restricted to safe integers from 1 through 65535.
