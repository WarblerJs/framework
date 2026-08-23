import { expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { startCaptured } from "./helpers";

interface CapturedHttp {
  readonly routes: Readonly<Record<string, Readonly<Record<string, (request: Request) => Response | Promise<Response>>>>>;
}

test("HTTP validator pipeline enforces declarative handler validation", async () => {
  const priorSecret = process.env.WARBLER_CSRF_SECRET;
  process.env.WARBLER_CSRF_SECRET = "abcdefghijklmnopqrstuvwxyz123456";
  let captured: CapturedHttp | undefined;
  const runtime = await startCaptured("http", (bindings) => { captured = bindings as CapturedHttp; });
  try {
    const route = captured?.routes["/api/test/:id"]?.POST;
    if (route === undefined) throw new Error("Declarative validation route was not generated");

    const token = signCsrfToken("acceptance-token", "abcdefghijklmnopqrstuvwxyz123456");
    const accepted = await route(jsonRequest("http://127.0.0.1/api/test/7?id=3", { message: "hello", yt: "youtube" }, token));
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toEqual({
      q: { id: 53 },
      p: { id: 57 },
      h: { "x-language": "en" },
      body: { message_content: "hello >>---added", yt: "youtube" },
    });

    const invalid = await route(jsonRequest("http://127.0.0.1/api/test/7?id=3", { message: "", yt: "youtube" }, token));
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ message: "Message kength is invalid." });
  } finally {
    if (priorSecret === undefined) delete process.env.WARBLER_CSRF_SECRET;
    else process.env.WARBLER_CSRF_SECRET = priorSecret;
    await runtime.stop();
  }
}, 20_000);

function jsonRequest(url: string, body: Readonly<Record<string, unknown>>, token?: string): Request {
  const request = new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-language": "en",
      ...(token === undefined ? {} : { "x-csrf-token": token }),
    },
    body: JSON.stringify(body),
  });
  Object.defineProperty(request, "params", { value: Object.freeze({ id: "7" }) });
  return request;
}
function signCsrfToken(token: string, secret: string): string {
  const signature = createHmac("sha256", new TextEncoder().encode(secret)).update(token).digest();
  return `${token}.${new Uint8Array(signature).toBase64({ alphabet: "base64url", omitPadding: true })}`;
}
