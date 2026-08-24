import { describe, expect, test } from "bun:test";
import { NotFoundError, WarblerError } from "@warblerjs/core";
import type { RequestHandle } from "@warblerjs/console";
import { HttpError } from "../src/errors";
import { renderRequestError } from "../src/errors";

function requestLog(overrides: Partial<RequestHandle> = {}): RequestHandle {
  return Object.freeze({ requestId: "req_test0001", method: "GET", path: "/users/123", startedAt: performance.now(), ...overrides });
}

describe("renderRequestError — JSON path (default)", () => {
  test("a typed WarblerError renders its code/message/status", async () => {
    const response = renderRequestError(new NotFoundError("USER_NOT_FOUND", "User not found"), new Request("http://x/users/123"), requestLog(), false);
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toStartWith("application/json");
    expect(await response.json()).toEqual({ code: "USER_NOT_FOUND", message: "User not found", requestId: "req_test0001" });
  });

  test("an HttpError is normalized the same way", async () => {
    const error = new HttpError("INVALID_ROUTE", "Bad route", 500);
    const response = renderRequestError(error, new Request("http://x/"), requestLog(), false);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ code: "INVALID_ROUTE", message: "Bad route", requestId: "req_test0001" });
  });

  test("a native Error is sanitized in production — never its real message", async () => {
    const response = renderRequestError(new Error("password=hunter2 leaked in stack"), new Request("http://x/"), requestLog(), false);
    expect(response.status).toBe(500);
    const body = await response.json() as Readonly<Record<string, unknown>>;
    expect(body).toEqual({ code: "INTERNAL_SERVER_ERROR", message: "Internal Server Error", requestId: "req_test0001" });
    const raw = JSON.stringify(body);
    expect(raw).not.toContain("hunter2");
  });

  test("a non-exposed WarblerError hides its message in the response but not the code", async () => {
    const response = renderRequestError(new WarblerError("DB_ERROR", 500, "connection string: postgres://user:pw@host", false), new Request("http://x/"), requestLog(), false);
    const body = await response.json() as Readonly<Record<string, unknown>>;
    expect(body.code).toBe("DB_ERROR");
    expect(body.message).toBe("Internal Server Error");
    expect(JSON.stringify(body)).not.toContain("postgres://");
  });

  test("development adds diagnostic fields without changing the safe fields", async () => {
    const response = renderRequestError(new Error("boom"), new Request("http://x/users/123", { method: "POST" }), requestLog({ method: "POST" }), true);
    const body = await response.json() as Readonly<Record<string, unknown>>;
    expect(body.code).toBe("INTERNAL_SERVER_ERROR");
    expect(body.message).toBe("Internal Server Error");
    expect(body.transport).toBe("HTTP");
    expect(body.request).toBe("POST /users/123");
    expect(body.reason).toBe("boom");
    expect(body.requestId).toBe("req_test0001");
  });

  test("development contains a stack trace, but production never does", async () => {
    const response = renderRequestError(new Error("boom"), new Request("http://x/"), requestLog(), true);
    const raw = await response.text();
    expect(raw).toContain("stack");
    expect(raw).toContain("at ");
    const production = renderRequestError(new Error("boom"), new Request("http://x/"), requestLog(), false);
    const productionRaw = await production.text();
    expect(productionRaw).not.toContain("at ");
  });
});

describe("renderRequestError — HTML/text path (Accept: text/html)", () => {
  const htmlRequest = new Request("http://x/users/123", { headers: { accept: "text/html,application/xhtml+xml" } });

  test("production returns a generic sanitized body", async () => {
    const response = renderRequestError(new Error("select * from users where password = ?"), htmlRequest, requestLog(), false);
    expect(response.status).toBe(500);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    const body = await response.text();
    expect(body).toContain("WARBLER_REQUEST_ERROR");
    expect(body).toContain("Internal Server Error");
    expect(body).toContain("req_test0001");
    expect(body).not.toContain("select");
  });

  test("an exposed typed error still shows its safe message and real status", async () => {
    const response = renderRequestError(new NotFoundError("USER_NOT_FOUND", "User not found"), htmlRequest, requestLog(), false);
    expect(response.status).toBe(404);
    const body = await response.text();
    expect(body).toContain("User not found");
    expect(body).toContain("USER_NOT_FOUND");
  });

  test("development returns the organized WARBLER_REQUEST_ERROR block using only available metadata", async () => {
    const response = renderRequestError(new Error("db down"), htmlRequest, requestLog({ path: "/users/123" }), true);
    const body = await response.text();
    expect(body).toContain("WARBLER_REQUEST_ERROR");
    expect(body).toContain("Code:</span> INTERNAL_SERVER_ERROR");
    expect(body).toContain("Transport:</span> HTTP");
    expect(body).toContain("Request:</span> GET /users/123");
    expect(body).toContain("Reason:</span> db down");
    expect(body).toContain("Request ID:</span> req_test0001");
    expect(body).toContain("Stack:");
    expect(body).toContain("at ");
  });

  test("prefers JSON when Accept lists application/json before text/html", async () => {
    const request = new Request("http://x/", { headers: { accept: "application/json, text/html" } });
    const response = renderRequestError(new Error("boom"), request, requestLog(), false);
    expect(response.headers.get("content-type")).toStartWith("application/json");
  });
});

describe("concurrent request isolation", () => {
  test("two overlapping renders never mix up request metadata", async () => {
    const [a, b] = await Promise.all([
      Promise.resolve().then(() => renderRequestError(new Error("a-failure"), new Request("http://x/a"), requestLog({ requestId: "req_a", path: "/a" }), true)),
      Promise.resolve().then(() => renderRequestError(new Error("b-failure"), new Request("http://x/b"), requestLog({ requestId: "req_b", path: "/b" }), true)),
    ]);
    const bodyA = await a.json() as Readonly<Record<string, unknown>>;
    const bodyB = await b.json() as Readonly<Record<string, unknown>>;
    expect(bodyA.requestId).toBe("req_a");
    expect(bodyA.reason).toBe("a-failure");
    expect(bodyB.requestId).toBe("req_b");
    expect(bodyB.reason).toBe("b-failure");
  });
});
