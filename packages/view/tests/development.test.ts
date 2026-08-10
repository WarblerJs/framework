import { afterEach, describe, expect, test } from "bun:test";
import {
  closeViewDevelopmentClients,
  createViewDevelopmentRoutes,
  publishViewDevelopmentUpdate,
} from "../src";

interface FakeServer {
  readonly timeouts: Array<readonly [Request, number]>;
  timeout(request: Request, seconds: number): void;
}
function createFakeServer(): FakeServer {
  const timeouts: Array<readonly [Request, number]> = [];
  return { timeouts, timeout(request, seconds) { timeouts.push([request, seconds]); } };
}
function connect(): Readonly<{ response: Response; server: FakeServer; reader: ReadableStreamDefaultReader<Uint8Array> }> {
  const routes = createViewDevelopmentRoutes();
  const request = new Request("http://127.0.0.1/__warbler/view/events");
  const server = createFakeServer();
  const handler = routes["/__warbler/view/events"]?.GET;
  if (handler === undefined) throw new Error("View development event route is missing.");
  const response = handler(request, server as unknown as Bun.Server<undefined>);
  return {
    response,
    server,
    reader: response.body!.getReader() as unknown as ReadableStreamDefaultReader<Uint8Array>,
  };
}
async function readFrame(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string> {
  const { value, done } = await reader.read();
  expect(done).toBe(false);
  return new TextDecoder().decode(value);
}

afterEach(() => { closeViewDevelopmentClients(); });

describe("View development SSE endpoint", () => {
  test("returns an open text/event-stream response without a content-length", () => {
    const { response } = connect();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    expect(response.headers.get("connection")).toBe("keep-alive");
    expect(response.headers.has("content-length")).toBe(false);
  });

  test("disables the native idle timeout so a quiet connection is never force-closed", () => {
    const { server } = connect();
    expect(server.timeouts).toHaveLength(1);
    expect(server.timeouts[0]![1]).toBe(0);
  });

  test("sends a ready event as soon as the client connects", async () => {
    const { reader } = connect();
    const frame = await readFrame(reader);
    expect(frame).toBe("event: ready\ndata: {}\n\n");
  });

  test("broadcasts a published update to a connected client", async () => {
    const { reader } = connect();
    await readFrame(reader);
    publishViewDevelopmentUpdate("css", "7");
    const frame = await readFrame(reader);
    expect(frame).toBe(`event: update\ndata: ${JSON.stringify({ type: "css", build: "7" })}\n\n`);
  });

  test("delivers one broadcast to every connected client", async () => {
    const first = connect();
    const second = connect();
    await readFrame(first.reader);
    await readFrame(second.reader);
    publishViewDevelopmentUpdate("javascript", "9");
    const [firstFrame, secondFrame] = await Promise.all([readFrame(first.reader), readFrame(second.reader)]);
    expect(firstFrame).toContain('"type":"javascript"');
    expect(secondFrame).toContain('"type":"javascript"');
  });

  test("removes a client from the registry on disconnect and leaves no dangling controller", async () => {
    const { reader } = connect();
    await reader.cancel();
    // A disconnected reader must not receive (or crash) a subsequent broadcast.
    expect(() => publishViewDevelopmentUpdate("reload", "1")).not.toThrow();
  });

  test("does not crash a broadcast when one of several clients has already disconnected", async () => {
    const stale = connect();
    const live = connect();
    await readFrame(stale.reader);
    await readFrame(live.reader);
    await stale.reader.cancel();
    expect(() => publishViewDevelopmentUpdate("reload", "2")).not.toThrow();
    const frame = await readFrame(live.reader);
    expect(frame).toContain('"type":"reload"');
  });

  test("closeViewDevelopmentClients cleanly ends open streams instead of leaving them dangling", async () => {
    const { reader } = connect();
    await readFrame(reader);
    closeViewDevelopmentClients();
    const { done } = await reader.read();
    expect(done).toBe(true);
    expect(() => publishViewDevelopmentUpdate("reload", "3")).not.toThrow();
  });
});
