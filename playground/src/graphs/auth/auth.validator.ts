export interface LoginInput {
  readonly username: string;
  readonly password: string;
}

function isLoginInput(value: unknown): value is LoginInput {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Readonly<Record<string, unknown>>;
  return typeof record.username === "string" && record.username.trim().length > 0
    && typeof record.password === "string" && record.password.length > 0;
}

export async function loginValidator(input: unknown): Promise<Readonly<{ valid: true; value: LoginInput }> | false> {
  if (!(input instanceof Request)) return false;
  const contentType = input.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") return false;
  try {
    const value: unknown = await input.json();
    return isLoginInput(value) ? Object.freeze({ valid: true, value }) : false;
  } catch {
    return false;
  }
}
