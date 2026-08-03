export default class AuthPolicy {
    public static readonly login = {
      permission: "auth.login",
    } as const;
  
    public static readonly required = {
      guard: "auth.required",
    } as const;
  }
  