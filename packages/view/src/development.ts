export type ViewDevelopmentUpdate = "reload" | "css" | "javascript";

const subscribers = new Set<ReadableStreamDefaultController<Uint8Array>>();
const encoder = new TextEncoder();

/** Publishes one successful update to connected development browsers. */
export function publishViewDevelopmentUpdate(type: ViewDevelopmentUpdate, build: string): void {
  const payload = encoder.encode(`event: update\ndata: ${JSON.stringify({ type, build })}\n\n`);
  for (const controller of subscribers) {
    try { controller.enqueue(payload); } catch { subscribers.delete(controller); }
  }
}

/** Cleanly ends every connected development stream; call before the native HTTP server is torn down or replaced. */
export function closeViewDevelopmentClients(): void {
  for (const controller of subscribers) {
    try { controller.close(); } catch { /* already closing */ }
  }
  subscribers.clear();
}

/** Routes mounted only by the HTTP development launcher. */
export function createViewDevelopmentRoutes(): Readonly<Record<string, Readonly<Record<string, (request: Request, server: Bun.Server<undefined>) => Response>>>> {
  return Object.freeze({
    "/__warbler/view/events": Object.freeze({
      GET: (request: Request, server: Bun.Server<undefined>) => {
        let active: ReadableStreamDefaultController<Uint8Array> | undefined;
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            active = controller;
            subscribers.add(controller);
            controller.enqueue(encoder.encode("event: ready\ndata: {}\n\n"));
          },
          cancel() { if (active !== undefined) subscribers.delete(active); },
        });
        // Long-lived streams must opt out of Bun's per-request idle timeout, mirroring the
        // RouteFlag.SSE handling in @warbler/http's compiled route pipeline (see bun-route-handler.ts).
        server.timeout(request, 0);
        return new Response(stream, { headers: {
          "cache-control": "no-cache, no-store",
          "content-type": "text/event-stream",
          connection: "keep-alive",
        } });
      },
    }),
    "/__warbler/view/client.js": Object.freeze({
      GET: () => new Response(DEVELOPMENT_CLIENT, { headers: {
        "cache-control": "no-cache, no-store",
        "content-type": "text/javascript; charset=utf-8",
      } }),
    }),
  });
}

export const VIEW_DEVELOPMENT_SCRIPT =
  '<script type="module" src="/__warbler/view/client.js" data-warbler-view></script>';

const DEVELOPMENT_CLIENT = `const key = Symbol.for("warbler.view.events");
if (!globalThis[key]) {
  const events = new EventSource("/__warbler/view/events");
  globalThis[key] = events;
  events.addEventListener("update", (event) => {
    const update = JSON.parse(event.data);
    if (update.type === "css") {
      for (const link of document.querySelectorAll('link[rel="stylesheet"]')) {
        const url = new URL(link.href);
        url.searchParams.set("build", update.build);
        link.href = url.href;
      }
      return;
    }
    location.reload();
  });
}
`;
