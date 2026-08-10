export function csrfToken(name = "csrf-token"): string | null {
  return document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)?.content ?? null;
}
export const csrf = { token: csrfToken };
