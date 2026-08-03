import { describe, expect, test } from "bun:test";
import {
  InvalidTransportError,
  TransportError,
  TransportHandle,
  TransportKind,
  TransportState,
  createTransportContext,
  type TransportAdapter,
} from "../src";

interface TestConfig {
  readonly port: number;
}

interface TestNative {
  readonly id: number;
}

describe("TransportHandle", () => {
  test("runs the synchronous lifecycle without Promise allocation", () => {
    let stoppedNative: TestNative | undefined;
    const adapter: TransportAdapter<TestConfig, TestNative> = {
      kind: TransportKind.TCP,
      start(context) {
        expect(Object.isFrozen(context)).toBe(true);
        expect(context.config.port).toBe(9000);
        return Object.freeze({ id: 1 });
      },
      stop(context) {
        expect(Object.isFrozen(context)).toBe(true);
        stoppedNative = context.native;
      },
    };
    const handle = new TransportHandle(
      adapter,
      Object.freeze({ port: 9000 }),
      createTransportContext(undefined),
    );
    expect(handle.state).toBe(TransportState.CREATED);
    const started = handle.start();
    expect(started).toBe(handle);
    expect(started).not.toBeInstanceOf(Promise);
    expect(handle.state).toBe(TransportState.RUNNING);
    expect(handle.native).toEqual({ id: 1 });
    const stopped = handle.stop();
    expect(stopped).toBeUndefined();
    expect(handle.state).toBe(TransportState.STOPPED);
    expect(handle.native).toBeUndefined();
    expect(stoppedNative).toEqual({ id: 1 });
  });

  test("tracks asynchronous startup and shutdown", async () => {
    const startup = Promise.withResolvers<TestNative>();
    const shutdown = Promise.withResolvers<void>();
    const adapter: TransportAdapter<TestConfig, TestNative, string> = {
      kind: TransportKind.WEBSOCKET,
      start(context) {
        expect(context.transport.shared).toBe("shared");
        return startup.promise;
      },
      stop() {
        return shutdown.promise;
      },
    };
    const handle = new TransportHandle(
      adapter,
      Object.freeze({ port: 8443 }),
      createTransportContext("shared"),
    );
    const starting = handle.start();
    expect(starting).toBeInstanceOf(Promise);
    expect(handle.state).toBe(TransportState.STARTING);
    startup.resolve({ id: 2 });
    expect(await starting).toBe(handle);
    expect(handle.state).toBe(TransportState.RUNNING);
    const stopping = handle.stop();
    expect(stopping).toBeInstanceOf(Promise);
    expect(handle.state).toBe(TransportState.STOPPING);
    shutdown.resolve();
    await stopping;
    expect(handle.state).toBe(TransportState.STOPPED);
  });

  test("rejects invalid lifecycle transitions", () => {
    const adapter: TransportAdapter<TestConfig, TestNative> = {
      kind: TransportKind.UDP,
      start: () => ({ id: 3 }),
      stop: () => undefined,
    };
    const handle = new TransportHandle(
      adapter,
      Object.freeze({ port: 9001 }),
      createTransportContext(undefined),
    );
    expect(() => handle.stop()).toThrow(InvalidTransportError);
    handle.start();
    expect(() => handle.start()).toThrow(InvalidTransportError);
    handle.stop();
    expect(() => handle.stop()).toThrow(InvalidTransportError);
    expect(() => handle.start()).toThrow(InvalidTransportError);
  });

  test("converts implementation failures to typed transport errors", async () => {
    const syncAdapter: TransportAdapter<TestConfig, TestNative> = {
      kind: TransportKind.HTTP,
      start() {
        throw "implementation failure";
      },
      stop: () => undefined,
    };
    const syncHandle = new TransportHandle(
      syncAdapter,
      Object.freeze({ port: 3000 }),
      createTransportContext(undefined),
    );
    expect(() => syncHandle.start()).toThrow(TransportError);
    expect(syncHandle.state).toBe(TransportState.STOPPED);

    const asyncAdapter: TransportAdapter<TestConfig, TestNative> = {
      kind: TransportKind.MCP,
      start: () => Promise.reject("implementation failure"),
      stop: () => undefined,
    };
    const asyncHandle = new TransportHandle(
      asyncAdapter,
      Object.freeze({ port: 8080 }),
      createTransportContext(undefined),
    );
    expect(asyncHandle.start()).rejects.toBeInstanceOf(TransportError);
    await Promise.resolve();
    expect(asyncHandle.state).toBe(TransportState.STOPPED);
  });
});
