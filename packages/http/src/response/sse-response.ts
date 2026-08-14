import { Console } from "@warbler/console";
import { normalizeError, safeErrorMessage } from "@warbler/core";
import { InvalidRequestError } from "../errors";
import { type HeadersInput, toHeaders } from "../internal/header-value";
import type { ServerSentEvent } from "./response-types";

function safeField(value: string, name: string): string {
  if (value.includes("\r") || value.includes("\n") || value.includes("\0")) {
    throw new InvalidRequestError(`SSE ${name} contains forbidden characters`);
  }
  return value;
}

/** Encodes one event using the Server-Sent Events line format. */
export function encodeServerSentEvent(event: ServerSentEvent): string {
  let output = "";
  if (event.id !== undefined) output += `id: ${safeField(event.id, "id")}\n`;
  if (event.event !== undefined) output += `event: ${safeField(event.event, "event")}\n`;
  if (event.retry !== undefined) {
    if (!Number.isSafeInteger(event.retry) || event.retry < 0) {
      throw new InvalidRequestError("SSE retry must be a non-negative safe integer");
    }
    output += `retry: ${event.retry}\n`;
  }
  const data = typeof event.data === "string" ? event.data : JSON.stringify(event.data);
  const lines = data.split(/\r\n|\r|\n/u);
  for (const line of lines) output += `data: ${line}\n`;
  return `${output}\n`;
}

/** Creates a backpressure-aware SSE response without timers or internal polling. */
export function SseRes(
  events: AsyncIterable<ServerSentEvent>,
  options: Readonly<{ signal?: AbortSignal; headers?: HeadersInput }> = {},
): Response {
  const iterator = events[Symbol.asyncIterator]();
  const stream = new ReadableStream<string>({
    async pull(controller) {
      if (options.signal?.aborted) {
        await iterator.return?.();
        controller.close();
        return;
      }
      try {
        const result = await iterator.next();
        if (result.done) controller.close();
        else controller.enqueue(encodeServerSentEvent(result.value));
      } catch (error) {
        // Headers/status are already committed once streaming has started — there is no
        // "normal HTTP error response" to fall back to. Emit one final safe SSE error
        // event and close gracefully; only if that itself fails (stream already
        // errored/closed) do we fall back to the raw stream error.
        const normalized = normalizeError(error);
        Console.error("SSE stream failed.", { code: normalized.code, status: normalized.status });
        const report: {
          code: string;
          status: number;
          message: string;
          developerMessage: string;
          fatal: boolean;
          stack?: string;
          cause: unknown;
        } = {
          code: normalized.code,
          status: normalized.status,
          message: safeErrorMessage(normalized, false),
          developerMessage: normalized.developerMessage ?? normalized.message,
          fatal: normalized.fatal,
          cause: normalized.cause,
        };
        if (normalized.stack !== undefined) report.stack = normalized.stack;
        Console.errorReport(Object.freeze(report), { transport: "SSE" });
        try {
          controller.enqueue(encodeServerSentEvent({
            event: "error",
            data: { code: normalized.code, message: safeErrorMessage(normalized, false) },
          }));
          controller.close();
        } catch {
          controller.error(error);
        }
      }
    },
    async cancel() {
      await iterator.return?.();
    },
  });
  const headers = toHeaders(options.headers);
  if (!headers.has("content-type")) headers.set("content-type", "text/event-stream; charset=utf-8");
  if (!headers.has("cache-control")) headers.set("cache-control", "no-cache");
  if (!headers.has("connection")) headers.set("connection", "keep-alive");
  if (!headers.has("x-accel-buffering")) headers.set("x-accel-buffering", "no");
  headers.delete("content-length");
  return new Response(stream, { headers });
}
