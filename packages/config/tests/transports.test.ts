import { describe, expect, test } from "bun:test";
import { httpConfig } from "../../../playground/src/config/transports/http.config";
import { mcpConfig } from "../../../playground/src/config/transports/mcp.config";
import { tcpConfig } from "../../../playground/src/config/transports/tcp.config";
import { udpConfig } from "../../../playground/src/config/transports/udp.config";
import { webrtcConfig } from "../../../playground/src/config/transports/webrtc.config";
import { wsConfig } from "../../../playground/src/config/transports/ws.config";
import {
  validateHttpConfig,
  validateMcpConfig,
  validateTcpConfig,
  validateUdpConfig,
  validateWebrtcConfig,
  validateWebsocketConfig,
} from "../src/validator";

describe("transport validation", () => {
  test("accepts every playground transport configuration", () => {
    expect(() => validateHttpConfig(httpConfig)).not.toThrow();
    expect(() => validateWebsocketConfig(wsConfig)).not.toThrow();
    expect(() => validateTcpConfig(tcpConfig)).not.toThrow();
    expect(() => validateUdpConfig(udpConfig)).not.toThrow();
    expect(() => validateMcpConfig(mcpConfig)).not.toThrow();
    expect(() => validateWebrtcConfig(webrtcConfig)).not.toThrow();
  });

  test("rejects malformed transport roots and unsafe numbers", () => {
    expect(() => validateHttpConfig({})).toThrow("http.request");
    expect(() =>
      validateUdpConfig({
        socket: { packet: { maxSize: Infinity } },
        sessionTracking: {},
        rateLimit: { onExceeded: "silent_drop" },
      }),
    ).toThrow("safe integer");
    expect(() =>
      validateWebsocketConfig({
        connection: {},
        rateLimit: { onExceeded: "wait", closeCode: 4029 },
      }),
    ).toThrow("websocket.rateLimit.onExceeded");
  });

  test("rejects a malformed body-policy byte-size string instead of letting it pass as plain text", () => {
    // "limit" doesn't end in size/buffer/threshold/length/bytes, and the value below is not
    // shaped like a byte size at all — before the fix, validateTree let this straight through.
    expect(() =>
      validateUdpConfig({
        socket: { packet: { maxSize: 10 } },
        sessionTracking: { limit: "unbounded" },
        rateLimit: { onExceeded: "silent_drop" },
      }),
    ).toThrow("sessionTracking.limit");
  });

  test("rejects a byte-size string of zero on a limit-shaped key", () => {
    expect(() =>
      validateUdpConfig({
        socket: { packet: { maxSize: 10 } },
        sessionTracking: { totalLimit: "0mb" },
        rateLimit: { onExceeded: "silent_drop" },
      }),
    ).toThrow("at least 1 byte");
  });

  test("rejects a malformed duration string on a timeout-shaped key", () => {
    // Before the fix, DURATION_KEY was defined but never consulted, so any non-empty string
    // passed validation on a *Timeout/*Interval/*Window key regardless of its shape.
    expect(() =>
      validateUdpConfig({
        socket: { packet: { maxSize: 10 } },
        sessionTracking: { idleTimeout: "soon" },
        rateLimit: { onExceeded: "silent_drop" },
      }),
    ).toThrow("sessionTracking.idleTimeout");
  });

  test("rejects an idle timeout that would exceed Bun's 255-second idleTimeout ceiling", () => {
    const badHttpConfig = {
      request: {
        body: { enabled: true, unknownContentType: "reject" },
        headers: {},
        query: {},
        cookies: {},
        path: {},
        timeouts: { headers: 5_000, body: 30_000, request: 60_000, idle: 10_000_000 },
      },
      rateLimit: { onExceeded: "reject", statusCode: 429 },
    };
    expect(() => validateHttpConfig(badHttpConfig)).toThrow("http.request.timeouts.idle");
  });

  test("accepts well-formed size and duration strings on the same key shapes", () => {
    expect(() =>
      validateUdpConfig({
        socket: { packet: { maxSize: 10 } },
        sessionTracking: { totalLimit: "5mb", idleTimeout: "30s" },
        rateLimit: { onExceeded: "silent_drop" },
      }),
    ).not.toThrow();
  });
});
