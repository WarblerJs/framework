import { describe, expect, test } from "bun:test";
import { Graph, Transport, getGraphMetadata } from "../src";

describe("Graph", () => {
  test("uses HTTP by default", () => {
    @Graph({ prefix: "/auth/" })
    class AuthGraph {}
    expect(getGraphMetadata(AuthGraph)).toEqual({
      prefix: "/auth",
      transport: Transport.HTTP,
      controllers: [],
      providers: [],
      middleware: [],
    });
  });

  test("stores immutable graph middleware", () => {
    const middleware = () => undefined;
    @Graph({ middleware: [middleware] })
    class AuthGraph {}
    expect(getGraphMetadata(AuthGraph)?.middleware).toEqual([middleware]);
    expect(Object.isFrozen(getGraphMetadata(AuthGraph)?.middleware)).toBe(true);
  });

  test("supports websocket graphs", () => {
    @Graph({ prefix: "/chat", transport: Transport.WEBSOCKET })
    class ChatGraph {}
    expect(getGraphMetadata(ChatGraph)?.transport).toBe(Transport.WEBSOCKET);
  });
});
