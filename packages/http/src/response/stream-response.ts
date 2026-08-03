import type { ResponseOptions } from "./response-types";

/** A pull-based source accepted by streaming response helpers. */
export type StreamSource = ReadableStream<Uint8Array | string> | AsyncIterable<Uint8Array | string>;

function iterableStream(
  source: AsyncIterable<Uint8Array | string>,
  signal?: AbortSignal,
): ReadableStream<Uint8Array | string> {
  const iterator = source[Symbol.asyncIterator]();
  return new ReadableStream({
    async pull(controller) {
      if (signal?.aborted) {
        await iterator.return?.();
        controller.close();
        return;
      }
      try {
        const result = await iterator.next();
        if (result.done) controller.close();
        else controller.enqueue(result.value);
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel() {
      await iterator.return?.();
    },
  });
}

/** Creates a pull-based streaming HTML response with cancellation propagation. */
export function HtmlStreamRes(
  source: StreamSource,
  options: ResponseOptions & Readonly<{ signal?: AbortSignal }> = {},
): Response {
  const headers = new Headers(options.headers);
  if (!headers.has("content-type")) headers.set("content-type", "text/html; charset=utf-8");
  const body = source instanceof ReadableStream ? source : iterableStream(source, options.signal);
  return new Response(body, { status: options.status, headers });
}
