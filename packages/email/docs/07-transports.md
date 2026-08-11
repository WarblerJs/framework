# Transports

`LogTransport` logs safe metadata only. `MemoryTransport` stores immutable
encoded messages for tests. `SMTPTransport` performs network delivery through
Bun sockets.
