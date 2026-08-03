import { describe, expect, test } from "bun:test";
import { Delete, Get, Head, Options, Patch, Post, Put, Sse, getRouteMetadata } from "../src/route";

describe("route decorators", () => {
  test("records every HTTP method and SSE metadata", () => {
    class Controller {
      @Get() get() {}
      @Post("/post") post() {}
      @Put("/put") put() {}
      @Patch("/patch") patch() {}
      @Delete("/delete") delete() {}
      @Options("/options") options() {}
      @Head("/head") head() {}
      @Sse("/events") events() {}
    }
    expect(getRouteMetadata(Controller.prototype.get)?.method).toBe("GET");
    expect(getRouteMetadata(Controller.prototype.post)?.method).toBe("POST");
    expect(getRouteMetadata(Controller.prototype.put)?.method).toBe("PUT");
    expect(getRouteMetadata(Controller.prototype.patch)?.method).toBe("PATCH");
    expect(getRouteMetadata(Controller.prototype.delete)?.method).toBe("DELETE");
    expect(getRouteMetadata(Controller.prototype.options)?.method).toBe("OPTIONS");
    expect(getRouteMetadata(Controller.prototype.head)?.method).toBe("HEAD");
    expect(getRouteMetadata(Controller.prototype.events)?.stream).toBe("sse");
  });
});
