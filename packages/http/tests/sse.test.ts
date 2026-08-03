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
});
