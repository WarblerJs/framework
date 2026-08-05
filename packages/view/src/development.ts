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

/** Routes mounted only by the HTTP development launcher. */
export function createViewDevelopmentRoutes(): Readonly<Record<string, Readonly<Record<string, () => Response>>>> {
  return Object.freeze({
    "/__warbler/view/events": Object.freeze({
      GET: () => {
        let active: ReadableStreamDefaultController<Uint8Array> | undefined;
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            active = controller;
            subscribers.add(controller);
            controller.enqueue(encoder.encode("event: ready\ndata: {}\n\n"));
          },
          cancel() { if (active !== undefined) subscribers.delete(active); },
        });
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
