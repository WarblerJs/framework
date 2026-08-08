/**
 * When the CSRF token travels in the request body (the `"form"`/`"json"` sources —
 * exactly what the `csrfField` view built-in submits via a plain HTML `<form>`), the
 * field is also, unavoidably, part of the body the application's own request
 * validator sees. `@warbler/validators` compiles every `bodyRules` schema as a strict
 * object (rejecting unrecognized keys) with no opt-out — so once CSRF verification has
 * consumed and confirmed the field, it is stripped out of the body in place, before the
 * validated handler pipeline ever parses it. The application's schema never needs to
 * know the framework's CSRF field exists.
 *
 * Only `application/x-www-form-urlencoded` and `application/json` bodies are handled —
 * these are what `readBodyToken` (`verify-csrf-request.ts`) actually reads the token
 * from. Multipart bodies are left untouched (stripping a field from a multipart stream
 * without disturbing file parts is materially more involved); a multipart route that
 * also carries the CSRF field in-body and validates strictly should declare the field
 * in its schema, or submit the token via the `"header"`/`"cookie"` source instead.
 *
 * Rewrites the request's body-reading methods in place (`Object.defineProperties`) —
 * not a replacement `Request` object — so identity-sensitive properties Bun attaches to
 * the native request (`.params`, `.cookies`, ...) are unaffected.
 */
export async function stripCsrfBodyField(
  request: Request,
  fieldName: string,
  kind: "form" | "json",
): Promise<void> {
  const contentType = request.headers.get("content-type") ?? "";

  // From here on the real body stream is read exactly once (`request.text()`) — after
  // that point the original stream is drained either way, so every path below must end
  // by re-installing a readable body (even when there was nothing to strip), or the
  // request would be left in a "body already used" state for the real handler pipeline.
  if (kind === "form") {
    if (!contentType.includes("application/x-www-form-urlencoded")) return;
    const text = await request.text();
    const params = new URLSearchParams(text);
    if (!params.has(fieldName)) {
      applyStrippedBody(request, text, "application/x-www-form-urlencoded;charset=UTF-8");
      return;
    }
    params.delete(fieldName);
    applyStrippedBody(request, params.toString(), "application/x-www-form-urlencoded;charset=UTF-8");
    return;
  }

  if (!contentType.includes("application/json")) return;
  const text = await request.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    applyStrippedBody(request, text, "application/json");
    return;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed) || !(fieldName in parsed)) {
    applyStrippedBody(request, text, "application/json");
    return;
  }
  const { [fieldName]: _removed, ...rest } = parsed as Record<string, unknown>;
  applyStrippedBody(request, JSON.stringify(rest), "application/json");
}

function applyStrippedBody(request: Request, text: string, contentType: string): void {
  const bytes = new TextEncoder().encode(text);
  const blob = new Blob([bytes], { type: contentType });
  Object.defineProperties(request, {
    text: { value: async (): Promise<string> => text, configurable: true },
    json: { value: async (): Promise<unknown> => JSON.parse(text), configurable: true },
    blob: { value: async (): Promise<Blob> => blob, configurable: true },
    arrayBuffer: { value: async (): Promise<ArrayBuffer> => bytes.buffer as ArrayBuffer, configurable: true },
  });
}
