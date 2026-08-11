import { describe, expect, test } from "bun:test";
import {
  OnDrain,
  OnOpen,
  SocketPublisher,
  SocketRuntimeNotReadyError,
  SocketController,
  Subscribe,
  activateSocketPublisherRuntime,
  createSocketContext,
  decodeSocketMessage,
  executeSocketGuards,
  getSocketControllerMetadata,
  getSocketEventMetadata,
  interpretSendResult,
  normalizeWebSocketConfig,
  resetSocketPublisherRuntimeForTests,
  safeCloseReason,
  validateOrigin,
  validateSubprotocol,
  validateTopic,
  type NativeSocketLike,
} from "../src";

describe("metadata", () => {
  test("stores immutable controller and event metadata", () => {
    class Controller { public open(): void {} public drain(): void {} public event(): void {} }
    SocketController()(Controller);
    OnOpen()(Controller.prototype, "open", {});
    OnDrain()(Controller.prototype, "drain", {});
    Subscribe("chat.message")(Controller.prototype, "event", {});
    expect(getSocketControllerMetadata(Controller)).toEqual({ controller: true });
    const metadata = getSocketEventMetadata(Controller.prototype);
    expect(metadata).toHaveLength(3);
    expect(Object.isFrozen(metadata)).toBe(true);
  });

  test("rejects duplicate events and lifecycle handlers", () => {
    class Controller { public first(): void {} public second(): void {} }
    OnOpen()(Controller.prototype, "first", {});
    expect(() => OnOpen()(Controller.prototype, "second", {})).toThrow();
    Subscribe("event")(Controller.prototype, "first", {});
    expect(() => Subscribe("event")(Controller.prototype, "second", {})).toThrow();
  });
});

describe("messages and security", () => {
  test("strictly decodes JSON envelopes", () => {
    expect(decodeSocketMessage('{"id":"1","event":"chat","data":{"ok":true}}')).toEqual({ id: "1", event: "chat", data: { ok: true } });
    expect(() => decodeSocketMessage("[]")).toThrow();
    expect(() => decodeSocketMessage('{"data":1}')).toThrow();
    expect(() => decodeSocketMessage('{"event":"toolong","data":1}', { maxEventNameLength: 3 })).toThrow();
  });

  test("does not copy binary data", () => {
    const bytes = new Uint8Array([1, 2]);
    expect(decodeSocketMessage(bytes, { format: "binary" }).data).toBe(bytes);
  });

  test("uses exact origins and configured protocols", () => {
    const config = normalizeWebSocketConfig({ security: { origins: { required: true, allowed: ["https://example.com"] }, protocols: { required: true, allowed: ["warbler.json.v1"] } } });
    const request = new Request("https://api.example.com/chat", { headers: { origin: "https://example.com", "sec-websocket-protocol": "other, warbler.json.v1" } });
    expect(() => validateOrigin(request, config.origins)).not.toThrow();
    expect(validateSubprotocol(request, config.protocols)).toBe("warbler.json.v1");
    expect(() => validateOrigin(new Request("https://api.example.com", { headers: { origin: "https://example.com.attacker.test" } }), config.origins)).toThrow();
  });

  test("validates topics and safe close reasons", () => {
    expect(validateTopic("room.general")).toBe("room.general");
    expect(() => validateTopic("@warbler/private")).toThrow();
    expect(new TextEncoder().encode(safeCloseReason("x".repeat(200))).byteLength).toBeLessThanOrEqual(123);
  });
});

describe("guards and native behavior", () => {
  test("preserves synchronous guard execution and short-circuits", () => {
    let calls = 0;
    const context = {} as Parameters<Parameters<typeof executeSocketGuards>[0][number]>[0]["context"];
    const result = executeSocketGuards([
      () => { calls++; return false; },
      () => { calls++; return true; },
    ], { message: { event: "x", data: null }, context });
    expect(result).toBe(false);
    expect(calls).toBe(1);
  });

  test("interprets native backpressure values", () => {
    expect(interpretSendResult(5)).toEqual({ status: "sent", bytes: 5 });
    expect(interpretSendResult(0)).toEqual({ status: "dropped" });
    expect(interpretSendResult(-1)).toEqual({ status: "backpressure" });
  });

  test("delegates context operations to native socket methods", () => {
    const calls: string[] = [];
    const socket: NativeSocketLike = {
      send() { calls.push("send"); return 4; },
      publish() { calls.push("publish"); return -1; },
      subscribe() { calls.push("subscribe"); },
      unsubscribe() { calls.push("unsubscribe"); },
      isSubscribed() { return true; },
      close() { calls.push("close"); },
      cork<T>(callback: () => T): T { calls.push("cork"); return callback(); },
    };
    const context = createSocketContext(socket, { id: "one", connectedAt: 1 });
    expect(context.send({ event: "x", data: 1 }).status).toBe("sent");
    expect(context.join("room")).toBe(true);
    expect(context.publish("room", { event: "x", data: 1 }).status).toBe("backpressure");
    context.cork(() => context.leave("room"));
    expect(calls).toEqual(["send", "subscribe", "publish", "cork", "unsubscribe"]);
  });

  test("SocketPublisher uses the same validated encoded publish path as SocketContext", () => {
    const calls: Array<Readonly<{ topic: string; data: string | ArrayBuffer | Uint8Array; compress?: boolean }>> = [];
    const socket: NativeSocketLike = {
      send() { return 1; },
      publish(topic, data, compress) { calls.push(Object.freeze({ topic, data, compress })); return 7; },
      subscribe() {},
      unsubscribe() {},
      isSubscribed() { return false; },
      close() {},
      cork<T>(callback: () => T): T { return callback(); },
    };
    const context = createSocketContext(socket, { id: "one", connectedAt: 1 });
    const contextResult = context.publish("room", { event: "x", data: { ok: true } }, { compress: true });

    resetSocketPublisherRuntimeForTests();
    activateSocketPublisherRuntime(Object.freeze({
      format: "json",
      publish(topic: string, data: string | ArrayBuffer | Uint8Array, compress?: boolean) {
        calls.push(Object.freeze({ topic, data, compress }));
        return 7;
      },
    }));
    const publisher = new SocketPublisher();
    const publisherResult = publisher.publish("room", { event: "x", data: { ok: true } }, { compress: true });

    expect(contextResult).toEqual(publisherResult);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual(calls[1]);
    expect(Object.getOwnPropertyNames(publisher)).toEqual([]);
    resetSocketPublisherRuntimeForTests();
  });

  test("SocketPublisher reports no active runtime synchronously", () => {
    resetSocketPublisherRuntimeForTests();
    expect(() => new SocketPublisher().publish("room", { event: "x", data: null })).toThrow(SocketRuntimeNotReadyError);
  });

  test("SocketPublisher leaves no-subscriber delivery as Bun's no-op result", () => {
    resetSocketPublisherRuntimeForTests();
    activateSocketPublisherRuntime(Object.freeze({
      format: "json",
      publish(): number { return 0; },
    }));
    expect(new SocketPublisher().publish("empty", { event: "x", data: null })).toEqual({ status: "dropped" });
    resetSocketPublisherRuntimeForTests();
  });
});

describe("configuration", () => {
  test("normalizes secure Bun limits and rejects invalid values", () => {
    const config = normalizeWebSocketConfig();
    expect(config.messages.maxPayloadLength).toBe(1024 ** 2);
    expect(config.compression.enabled).toBe(false);
    expect(config.backpressure.closeOnLimit).toBe(true);
    expect(() => normalizeWebSocketConfig({ messages: { maxPayloadLength: "0b" } })).toThrow();
    expect(() => normalizeWebSocketConfig({ timeouts: { idle: "1ms" } })).toThrow();
  });
});
