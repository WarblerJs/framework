export interface CreateUserRequest {
  readonly email: string;
  readonly password: string;
  readonly isActive?: boolean;
}

export function isCreateUserRequest(
  value: unknown,
): value is CreateUserRequest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const input = value as Readonly<Record<string, unknown>>;

  return (
    typeof input.email === "string" &&
    input.email.trim().length > 0 &&
    typeof input.password === "string" &&
    input.password.length >= 8 &&
    (
      input.isActive === undefined ||
      typeof input.isActive === "boolean"
    )
  );
}
