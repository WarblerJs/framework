export type SubmissionMode = "native" | "fetch";

/** Uses attribute presence so an omitted action is not confused with the browser-resolved URL. */
export function submissionMode(hasActionAttribute: boolean): SubmissionMode {
  return hasActionAttribute ? "native" : "fetch";
}

export function createFetchSubmission(form: HTMLFormElement, pageUrl: string): Readonly<{ url: string; init: RequestInit }> {
  const method = (form.getAttribute("method") ?? "get").trim().toUpperCase() || "GET";
  const data = new FormData(form);
  if (method === "GET" || method === "HEAD") {
    const url = new URL(pageUrl);
    for (const [name, value] of data) {
      if (typeof value === "string") url.searchParams.append(name, value);
      else url.searchParams.append(name, value.name);
    }
    return Object.freeze({ url: url.href, init: Object.freeze({ method }) });
  }
  return Object.freeze({ url: pageUrl, init: Object.freeze({ method, body: data }) });
}

export interface NormalizedServerErrors {
  readonly message?: string;
  readonly fields: Readonly<Record<string, string>>;
}

/** Strictly normalizes the common JSON validation response without trusting its prototype. */
export function normalizeServerErrors(value: unknown): NormalizedServerErrors {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return Object.freeze({ fields: Object.freeze({}) });
  const record = value as Readonly<Record<string, unknown>>;
  const fields: Record<string, string> = Object.create(null);
  const errors = record["errors"];
  if (typeof errors === "object" && errors !== null && !Array.isArray(errors)) {
    for (const [name, message] of Object.entries(errors)) {
      if (name !== "__proto__" && name !== "prototype" && name !== "constructor" && typeof message === "string") fields[name] = message;
    }
  }
  return Object.freeze({
    ...(typeof record["message"] === "string" ? { message: record["message"] } : {}),
    fields: Object.freeze(fields),
  });
}
