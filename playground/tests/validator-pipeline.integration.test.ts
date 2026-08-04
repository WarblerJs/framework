import { expect, test } from "bun:test";
import { startCaptured } from "./helpers";

interface CapturedHttp {
  readonly routes: Readonly<Record<string, Readonly<Record<string, (request: Request) => Response | Promise<Response>>>>>;
}
type Route = (request: Request) => Response | Promise<Response>;

test("HTTP validator pipeline parses every source, translates, maps, and stops invalid handlers", async () => {
  let captured: CapturedHttp | undefined;
  const runtime = await startCaptured("http", (bindings) => { captured = bindings as CapturedHttp; });
  try {
    const route = captured?.routes["/api/auth/validate/:id"]?.POST;
    if (route === undefined) throw new Error("Validation integration route was not generated");

    const json = await route(request(
      "http://127.0.0.1/api/auth/validate/12?page=2&type=active",
      { username: "habib", password: "secret" },
      "12",
    ));
    expect(json.status).toBe(200);
    expect(await json.json()).toEqual({
      body: { name: "habib", password: "secret##@@", email: "habib@test" },
      page: 2,
      id: 12,
      retries: 3,
      session: "session-one",
      calls: 1,
    });

    const form = new URLSearchParams({ username: "habib", password: "secret" });
    const encodedRequest = new Request("http://127.0.0.1/api/auth/validate/13?page=4&type=active", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-retries": "5",
        cookie: "session=session-two",
      },
      body: form,
    });
    Object.defineProperty(encodedRequest, "params", { value: Object.freeze({ id: "13" }) });
    const encoded = await route(encodedRequest);
    expect(encoded.status).toBe(200);
    expect(await encoded.json()).toEqual({
      body: { name: "habib", password: "secret##@@", email: "habib@test" },
      page: 4,
      id: 13,
      retries: 5,
      session: "session-two",
      calls: 2,
    });

    const invalid = await route(request(
      "http://127.0.0.1/api/auth/validate/-1?page=bad&type=active",
      { username: "", password: 4, unknown: true },
      "-1",
      { "x-retries": "bad", cookie: "" },
    ));
    expect(invalid.status).toBe(400);
    const errors = await invalid.json() as Readonly<Record<string, string>>;
    expect(errors.username).toBe("Username is invalid.");
    expect(errors.password).toBe("This value must be a string.");
    expect(errors.page).toBe("Page must be a positive number.");
    expect(errors.id).toBe("ID must be a positive number.");
    expect(errors["x-retries"]).toBe("Retry count is invalid.");
    expect(errors.session).toBe("Session is invalid.");
    expect(errors.body).toBe("The request contains unknown fields.");

    const afterFailure = await route(request(
      "http://127.0.0.1/api/auth/validate/14?page=1&type=active",
      { username: "next", password: "secret" },
      "14",
    ));
    expect((await afterFailure.json() as Readonly<{ calls: number }>).calls).toBe(3);

    for (const [locale, message] of [
      ["fr", "Le nom d’utilisateur est invalide."],
      ["ar", "اسم المستخدم غير صالح."],
    ] as const) {
      const localized = await route(request(
        `http://127.0.0.1/${locale}/api/auth/validate/12?page=2&type=active`,
        { username: "", password: "secret" },
        "12",
      ));
      expect((await localized.json() as Readonly<Record<string, string>>).username).toBe(message);
    }
  } finally {
    await runtime.stop();
  }
}, 20_000);

function request(
  url: string,
  body: Readonly<Record<string, unknown>>,
  id: string,
  extraHeaders: Readonly<Record<string, string>> = {},
): Request {
  const value = new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-retries": extraHeaders["x-retries"] ?? "3",
      cookie: extraHeaders.cookie ?? "session=session-one",
    },
    body: JSON.stringify(body),
  });
  Object.defineProperty(value, "params", { value: Object.freeze({ id }) });
  return value;
}
