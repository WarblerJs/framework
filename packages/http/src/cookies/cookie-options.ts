/** Cookie same-site policy. */
export type CookieSameSite = "Strict" | "Lax" | "None";

/** Cookie scheduling priority. */
export type CookiePriority = "Low" | "Medium" | "High";

/** Options for secure cookie serialization. */
export interface CookieOptions {
  readonly domain?: string;
  readonly expires?: Date;
  readonly httpOnly?: boolean;
  readonly maxAge?: number;
  readonly partitioned?: boolean;
  readonly path?: string;
  readonly priority?: CookiePriority;
  readonly sameSite?: CookieSameSite;
  readonly secure?: boolean;
}
