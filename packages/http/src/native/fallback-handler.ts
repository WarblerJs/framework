import type { HttpFallbackHandler } from "./native-server.types";

const NOT_FOUND_HEADERS = Object.freeze({
  "content-type": "text/plain; charset=utf-8",
  "x-content-type-options": "nosniff",
});

/** Creates a fallback used only after Bun's native route matcher returns no route. */
export function createNotFoundFallback(): HttpFallbackHandler {
  return () => new Response("Not Found", { status: 404, headers: NOT_FOUND_HEADERS });
}
