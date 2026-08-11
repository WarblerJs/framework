# Performance And Event Loop

`dispatch()` is not background CPU execution. A synchronous listener still runs on Bun's JavaScript
thread and can block the event loop.

Good listener work:

- socket publish
- telemetry
- audit write
- small SMTP/API I/O
- cache invalidation

Heavy CPU work belongs in a job or worker. Durable/retryable work belongs in a queue or outbox.

`dispatchAndWait()` starts independent async listeners together, so a slow SMTP listener does not
serialize a fast audit listener declared after it.
