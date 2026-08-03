import type { BodyPolicy } from "../body";
import type { CsrfPolicy } from "../csrf";
import type { ForwardedHeaderPolicy, RequestHeaderPolicy, SecurityHeaderPolicy } from "../security";
import type { StaticPolicy } from "../static";

/** Normalized query, cookie, and path limits. */
export interface NormalizedRequestLimits {
  readonly headers: RequestHeaderPolicy;
  readonly query: Readonly<{ maxParameters: number; maxDepth: number }>;
  readonly cookies: Readonly<{ maxCount: number; maxSize: number }>;
  readonly path: Readonly<{ maxSize: number; maxParams: number }>;
}

/** Normalized HTTP timeouts in milliseconds. */
export interface NormalizedHttpTimeouts {
  readonly headers: number;
  readonly body: number;
  readonly request: number;
}

/** Fully validated immutable HTTP transport configuration. */
export interface NormalizedHttpConfig {
  readonly host: string;
  readonly port: number;
  readonly development: boolean;
  readonly reusePort: boolean;
  readonly idleTimeoutSeconds?: number;
  readonly maxRequestBodySize: number;
  readonly allowedHosts: readonly string[];
  readonly body: BodyPolicy;
  readonly security: SecurityHeaderPolicy;
  readonly forwarded: ForwardedHeaderPolicy;
  readonly limits: NormalizedRequestLimits;
  readonly timeouts: NormalizedHttpTimeouts;
  readonly csrf: CsrfPolicy;
  readonly static: StaticPolicy;
}
