import { describe, expect, test } from "bun:test";
import {
  InvalidTransportError,
  TransportAlreadyRegisteredError,
  TransportKind,
  TransportNotFoundError,
  TransportRegistry,
} from "../src";

interface Registration {
  readonly kind: typeof TransportKind.HTTP | typeof TransportKind.TCP;
  readonly label: string;
}

describe("TransportRegistry", () => {
  test("registers and retrieves adapters by constant-time key lookup", () => {
    const registry = new TransportRegistry<Registration>();
    const registration = Object.freeze({
      kind: TransportKind.HTTP,
      label: "http-adapter",
    });
    expect(registry.register(registration)).toBe(registry);
    expect(registry.size).toBe(1);
    expect(registry.has(TransportKind.HTTP)).toBe(true);
    expect(registry.get(TransportKind.HTTP)).toBe(registration);
  });

  test("rejects duplicate kinds", () => {
    const registry = new TransportRegistry<Registration>();
    registry.register({ kind: TransportKind.TCP, label: "first" });
    expect(() =>
      registry.register({ kind: TransportKind.TCP, label: "second" }),
    ).toThrow(TransportAlreadyRegisteredError);
    expect(registry.size).toBe(1);
    expect(registry.get(TransportKind.TCP).label).toBe("first");
  });

  test("throws a typed error for unknown transports", () => {
    const registry = new TransportRegistry();
    expect(registry.has(TransportKind.UDP)).toBe(false);
    expect(() => registry.get(TransportKind.UDP)).toThrow(TransportNotFoundError);
  });

  test("rejects invalid runtime registrations", () => {
    const registry = new TransportRegistry();
    expect(() => Reflect.apply(registry.register, registry, [null])).toThrow(
      InvalidTransportError,
    );
    expect(() => Reflect.apply(registry.register, registry, [{ kind: "invalid" }])).toThrow(
      InvalidTransportError,
    );
  });
});
