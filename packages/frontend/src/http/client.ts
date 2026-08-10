import { HttpError } from "./errors";
import type { HttpOptions } from "./types";

async function request<T>(method: string, url: string, options: HttpOptions = {}): Promise<T> {
  const headers = new Headers(options.headers);
  let body: BodyInit | undefined;
  if (options.body !== undefined) {
    if (options.body instanceof FormData || typeof options.body === "string" || options.body instanceof Blob) body = options.body;
    else { headers.set("content-type", "application/json"); body = JSON.stringify(options.body); }
  }
  const response = await fetch(url, { ...options, method, headers, body });
  if (!response.ok) throw new HttpError(response.status, response.statusText, response);
  if (response.status === 204) return undefined as T;
  const type = response.headers.get("content-type") ?? "";
  return (type.includes("application/json") ? response.json() : response.text()) as Promise<T>;
}

export const http = {
  request,
  get: <T = unknown>(url: string, options?: HttpOptions) => request<T>("GET", url, options),
  post: <T = unknown>(url: string, body?: unknown, options: HttpOptions = {}) => request<T>("POST", url, { ...options, body }),
  put: <T = unknown>(url: string, body?: unknown, options: HttpOptions = {}) => request<T>("PUT", url, { ...options, body }),
  patch: <T = unknown>(url: string, body?: unknown, options: HttpOptions = {}) => request<T>("PATCH", url, { ...options, body }),
  delete: <T = unknown>(url: string, options?: HttpOptions) => request<T>("DELETE", url, options),
};
