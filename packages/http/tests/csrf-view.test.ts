import { describe, expect, test } from "bun:test";
import { activateCompiledViews, createCompiledViewArtifact } from "@warbler/view";
import { CsrfVerifier, type CsrfPolicy } from "../src/csrf";
import { HttpMethod } from "../src/route";
import { csrf, runInViewRequestScope, view, type ViewRequestScope } from "../src/view";

const POLICY: CsrfPolicy = Object.freeze({
  enabled: true,
  methods: Object.freeze([HttpMethod.POST, HttpMethod.PUT, HttpMethod.PATCH, HttpMethod.DELETE]),
  headerName: "x-csrf-token",
  cookieName: "__Host-warbler-csrf",
  fieldName: "_csrf",
  sources: Object.freeze(["header" as const]),
  strictSources: true,
});

async function scopeWithVerifier(): Promise<{ verifier: CsrfVerifier; scope: (request?: Request) => ViewRequestScope }> {
  const verifier = await CsrfVerifier.create("a-secure-csrf-signing-secret-0001");
  return {
    verifier,
    scope: (request = new Request("http://example.com/")) => {
      let cached: string | undefined;
      return Object.freeze({
        request,
        development: true,
        csrfFieldName: POLICY.fieldName,
        resolveAsset: (path: string) => path,
        resolveRoute: () => "/unused",
        issueCsrfToken: () => (cached ??= verifier.signSync(crypto.randomUUID())),
      });
    },
  };
}

describe("csrfField / csrfToken / csrf()", () => {
  test("csrfField renders the configured field name as a trusted hidden input", async () => {
    const { scope } = await scopeWithVerifier();
    activateCompiledViews(createCompiledViewArtifact({ templates: { home: "{{{ csrfField }}}" } }));
    const response = runInViewRequestScope(scope(), () => view("home", {}));
    const body = await response.text();
    expect(body).toStartWith('<input type="hidden" name="_csrf" value="');
    expect(body).toEndWith('">');
  });

  test("csrfField safely escapes attribute-breaking characters in the field name and token", async () => {
    const { verifier } = await scopeWithVerifier();
    let cached: string | undefined;
    const maliciousScope: ViewRequestScope = Object.freeze({
      request: new Request("http://example.com/"),
      development: true,
      csrfFieldName: '"><script>alert(1)</script>',
      resolveAsset: (path: string) => path,
      resolveRoute: () => "/unused",
      issueCsrfToken: () => (cached ??= verifier.signSync("token\"with'quotes")),
    });
    activateCompiledViews(createCompiledViewArtifact({ templates: { home: "{{{ csrfField }}}" } }));
    const body = await runInViewRequestScope(maliciousScope, () => view("home", {})).text();
    expect(body).not.toContain("<script>");
    expect(body).toContain("&quot;&gt;&lt;script&gt;");
  });

  test("csrfToken follows normal escaped interpolation", async () => {
    const { scope } = await scopeWithVerifier();
    activateCompiledViews(createCompiledViewArtifact({ templates: { home: "{{ csrfToken }}" } }));
    const body = await runInViewRequestScope(scope(), () => view("home", {})).text();
    expect(body).not.toContain("<");
    expect(body.length).toBeGreaterThan(10);
  });

  test("a minted token passes real CsrfVerifier.verify()", async () => {
    const { verifier, scope } = await scopeWithVerifier();
    const active = scope();
    const token = active.issueCsrfToken();
    const request = new Request("http://example.com/", { method: "POST", headers: { "x-csrf-token": token } });
    const result = await verifier.verify(request, POLICY, true);
    expect(result.valid).toBe(true);
  });

  test("explicit csrf() and the csrfField/csrfToken built-ins agree within one request", async () => {
    const { scope } = await scopeWithVerifier();
    activateCompiledViews(createCompiledViewArtifact({
      templates: { home: "{{ csrfToken }}|{{{ csrfField }}}|{{ security.token }}|{{{ security.field }}}" },
    }));
    const active = scope();
    const explicit = runInViewRequestScope(active, () => csrf());
    const body = await runInViewRequestScope(active, () => view("home", { security: explicit })).text();

    const [builtinToken, builtinField, explicitToken, explicitField] = body.split("|");
    expect(builtinToken).toBe(explicit.token);
    expect(explicitToken).toBe(explicit.token);
    expect(builtinField).toContain(`value="${explicit.token}"`);
    expect(explicitField).toContain(`value="${explicit.token}"`);
  });
});

describe("concurrent request isolation (mandatory)", () => {
  test("request A's CSRF token never appears in request B's response, even when interleaved", async () => {
    const { verifier } = await scopeWithVerifier();
    activateCompiledViews(createCompiledViewArtifact({ templates: { home: "{{ csrfToken }}" } }));

    const run = async (label: string): Promise<{ label: string; token: string }> => {
      let cached: string | undefined;
      const scope: ViewRequestScope = Object.freeze({
        request: new Request(`http://example.com/${label}`),
        development: true,
        csrfFieldName: "_csrf",
        resolveAsset: (path: string) => path,
        resolveRoute: () => "/unused",
        issueCsrfToken: () => (cached ??= verifier.signSync(`${label}-${crypto.randomUUID()}`)),
      });
      // Simulate real async work interleaving (validators/guards/awaited handlers)
      // between opening the scope and actually rendering.
      return runInViewRequestScope(scope, async () => {
        await Promise.resolve();
        await new Promise((resolve) => setTimeout(resolve, Math.random() * 5));
        const body = await view("home", {}).text();
        return { label, token: body };
      });
    };

    const results = await Promise.all([run("a"), run("b"), run("c"), run("d")]);
    const tokens = new Set(results.map((result) => result.token));
    expect(tokens.size).toBe(results.length);
    for (const result of results) {
      expect(result.token.startsWith(`${result.label}-`)).toBe(true);
    }
  });
});
