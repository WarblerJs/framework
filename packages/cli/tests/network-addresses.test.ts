import { describe, expect, test } from "bun:test";
import { networkInterfaces } from "node:os";
import { resolveNetworkAddresses } from "../src/dev/network-addresses";

describe("resolveNetworkAddresses", () => {
  test("reports a specific bound host as-is, without expanding it", () => {
    expect(resolveNetworkAddresses("192.168.1.3", 3000)).toEqual(["http://192.168.1.3:3000"]);
    expect(resolveNetworkAddresses("localhost", 3000)).toEqual(["http://localhost:3000"]);
  });

  test("brackets a literal IPv6 host", () => {
    expect(resolveNetworkAddresses("::1", 3000)).toEqual(["http://[::1]:3000"]);
  });

  test("expands a wildcard host into localhost plus every non-internal IPv4 LAN address", () => {
    const expectedLan = Object.values(networkInterfaces())
      .flatMap((entries) => entries ?? [])
      .filter((entry) => entry.family === "IPv4" && !entry.internal)
      .map((entry) => `http://${entry.address}:3000`);

    expect(resolveNetworkAddresses("0.0.0.0", 3000)).toEqual(["http://localhost:3000", ...expectedLan]);
    expect(resolveNetworkAddresses("::", 3000)).toEqual(["http://localhost:3000", ...expectedLan]);
  });
});
