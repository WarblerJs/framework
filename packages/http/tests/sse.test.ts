import { describe, expect, test } from "bun:test";
import { SseRes } from "../src";
import { encodeServerSentEvent } from "../src/response";

describe("SSE", () => {
  test("encodes multiline and object data once", () => {
    expect(encodeServerSentEvent({ event: "ready", data: "a\nb" })).toBe(
      "event: ready\ndata: a\ndata: b\n\n",
    );
    expect(encodeServerSentEvent({ data: { ok: true } })).toContain('data: {"ok":true}');
    expect(() => encodeServerSentEvent({ id: "bad\nid", data: "x" })).toThrow();
  });

  test("sets required headers and omits content length", async () => {
    async function* events() { yield { data: "ready" }; }
    const response = SseRes(events());
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(response.headers.has("content-length")).toBe(false);
    expect(await response.text()).toBe("data: ready\n\n");
  });

  describe("unified exception boundary", () => {
    test("a generator that throws mid-stream emits a safe error event and closes cleanly, not a raw stream error", async () => {
      async function* events() {
        yield { event: "ready", data: { ok: true } };
        throw new Error("upstream feed disconnected");
      }
      const response = SseRes(events());
      const body = await response.text();
      expect(body).toBe(
        'event: ready\ndata: {"ok":true}\n\n' +
        'event: error\ndata: {"code":"INTERNAL_SERVER_ERROR","message":"Internal Server Error"}\n\n',
      );
    });

    test("the client never sees the original error's message", async () => {
      async function* events(): AsyncGenerator<never> {
        throw new Error("connection string: postgres://user:pw@host/db");
      }
      const response = SseRes(events());
      const body = await response.text();
      expect(body).not.toContain("postgres://");
      expect(body).toContain('"code":"INTERNAL_SERVER_ERROR"');
    });
  });
});
