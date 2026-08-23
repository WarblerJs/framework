import { describe, expect, test } from "bun:test";
import { defineValidator, v } from "@warbler/validators";
import { Delete, Get, Head, Options, Patch, Post, Put, Sse, getRouteMetadata } from "../src/route";
import { redirect, redirectTo } from "../src/response";
import type { AppRequest, Guard, Middleware } from "../src/request";

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

  test("infers body/params/query from a single AppRequest<typeof validator> generic", () => {
    const loginValidator = defineValidator({
      bodyRules: { email: v.string() },
      paramRules: { id: v.number() },
      queryRules: { page: v.number() },
      headerRules: { "x-language": v.string() },
      cookieRules: { session: v.string() },
    });
    let observedEmail: string | undefined;
    let observedId: number | undefined;
    let observedPage: number | undefined;
    let observedLanguage: string | undefined;
    let observedSession: string | undefined;
    class Controller {
      @Post("/login/:id", { validator: loginValidator })
      login(req: AppRequest<typeof loginValidator>) {
        observedEmail = req.body.email;
        observedId = req.params.id;
        observedPage = req.query.page;
        observedLanguage = req.headers["x-language"];
        observedSession = req.cookies.session;
        // @ts-expect-error native Request is not available to production handlers
        req.native;
        // @ts-expect-error undeclared raw headers are not present on validated headers
        req.headers["content-type"];
      }
    }
    const metadata = getRouteMetadata(Controller.prototype.login);
    // HttpRouteMetadata's own `validator` field stays untyped (V defaults to
    // `undefined`) since it's a generic storage slot read by the compiler/runtime,
    // not something callers of `getRouteMetadata` narrow at the type level.
    expect(metadata?.validator as unknown).toBe(loginValidator);
    new Controller().login({
      body: { email: "a@b.com" }, params: { id: 1 }, query: { page: 2 }, headers: { "x-language": "en" }, cookies: { session: "s1" },
    } as AppRequest<typeof loginValidator>);
    expect(observedEmail).toBe("a@b.com");
    expect(observedId).toBe(1);
    expect(observedPage).toBe(2);
    expect(observedLanguage).toBe("en");
    expect(observedSession).toBe("s1");
  });

  test("guards/middleware type-check against the route's inferred AppRequest shape", () => {
    const idValidator = defineValidator({ paramRules: { id: v.number() } });
    let guardSawId: number | undefined;
    class Controller {
      @Get("/:id", {
        validator: idValidator,
        guards: [(req, context) => { guardSawId = req.params.id; context.set("checked", true); return true; }],
        middleware: [(req, context, next) => { context.set("seen", req.params.id); return next(); }],
      })
      show(req: AppRequest<typeof idValidator>) { return req.params.id; }
    }
    const metadata = getRouteMetadata(Controller.prototype.show);
    expect(metadata?.guards?.length).toBe(1);
    expect(metadata?.middleware?.length).toBe(1);
    expect(guardSawId).toBeUndefined(); // guard not invoked here — this test only checks it type-checks and records metadata.
  });

  test("bare AppRequest (no generics) keeps body permissive but still compiles", () => {
    class Controller {
      @Get("/whoami")
      whoami(req: AppRequest) { return typeof req.body; }
    }
    expect(getRouteMetadata(Controller.prototype.whoami)?.method).toBe("GET");
  });

  test("bare Guard/Middleware (no generics) type-check on a route with no validator", () => {
    const authGuard: Guard = (req, context) => { context.set("checked", true); return true; };
    const auditMiddleware: Middleware = (req, context, next) => next();
    const redirectGuard: Guard = () => redirect("/");
    const namedRedirectGuard: Guard = () => redirectTo("home");
    const asyncNamedRedirectGuard: Guard = async () => redirectTo("home");
    const permanent = () => redirect("/", 301);
    const seeOther = () => redirectTo("home", 303);
    // @ts-expect-error Redirect statuses are limited to standard redirect codes.
    const invalidRedirectStatus = () => redirect("/", 304);
    // @ts-expect-error Redirect statuses are limited to standard redirect codes.
    const invalidNamedRedirectStatus = () => redirectTo("home", 304);
    // @ts-expect-error Guard may only return boolean, Response, or a Promise of either.
    const invalidGuard: Guard = () => "home";
    void redirectGuard; void namedRedirectGuard; void asyncNamedRedirectGuard; void permanent; void seeOther; void invalidRedirectStatus; void invalidNamedRedirectStatus; void invalidGuard;
    class Controller {
      @Get("/profile/:id", { guards: [authGuard], middleware: [auditMiddleware] })
      profile(req: AppRequest) { return req.params; }
    }
    const metadata = getRouteMetadata(Controller.prototype.profile);
    expect(metadata?.guards?.length).toBe(1);
    expect(metadata?.middleware?.length).toBe(1);
  });
});
