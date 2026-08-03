import { describe, expect, test } from "bun:test";
import * as transport from "../src";
import {
  TransportKind,
  TransportState,
  createTransportContext,
  type MaybePromise,
  type TransportAdapter,
  type TransportFactory,
} from "../src";

describe("transport contracts", () => {
  test("exposes every stable transport kind", () => {
    expect(TransportKind).toEqual({
      HTTP: "http",
      WEBSOCKET: "websocket",
      TCP: "tcp",
      UDP: "udp",
      MCP: "mcp",
      WEBRTC: "webrtc",
    });
    expect(Object.isFrozen(TransportKind)).toBe(true);
  });

  test("exposes exactly five immutable lifecycle states", () => {
    expect(Object.values(TransportState)).toEqual([
      "created",
      "starting",
      "running",
      "stopping",
      "stopped",
    ]);
    expect(Object.isFrozen(TransportState)).toBe(true);
  });

  test("supports synchronous and asynchronous MaybePromise contracts", async () => {
    const synchronous: MaybePromise<number> = 1;
    const asynchronous: MaybePromise<number> = Promise.resolve(2);
    expect(synchronous).toBe(1);
    expect(await asynchronous).toBe(2);
  });

  test("supports typed adapter factories", () => {
    const factory: TransportFactory<Readonly<{ port: number }>, string, symbol> = {
      kind: TransportKind.TCP,
      create(context) {
        const adapter: TransportAdapter<Readonly<{ port: number }>, string, symbol> = {
          kind: TransportKind.TCP,
          start(startContext) {
            expect(startContext.transport).toBe(context);
            return `native:${startContext.config.port}`;
          },
          stop: () => undefined,
        };
        return adapter;
      },
    };
    const context = createTransportContext(Symbol("application"));
    expect(factory.create(context).start({ config: { port: 9000 }, transport: context })).toBe(
      "native:9000",
    );
  });

  test("exports only the stable runtime surface", () => {
    expect(Object.keys(transport).sort()).toEqual([
      "InvalidTransportError",
      "TransportAlreadyRegisteredError",
      "TransportError",
      "TransportHandle",
      "TransportKind",
      "TransportNotFoundError",
      "TransportRegistry",
      "TransportState",
      "createTransportContext",
    ]);
  });
});
