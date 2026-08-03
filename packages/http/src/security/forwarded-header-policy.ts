/** Trusted-proxy policy for forwarded client address headers. */
export interface ForwardedHeaderPolicy {
  readonly trustProxy: boolean;
  readonly trustedProxies: readonly string[];
}

/** Returns a forwarded client address only when the immediate proxy is explicitly trusted. */
export function getForwardedClientIp(
  request: Request,
  immediateIp: string,
  policy: ForwardedHeaderPolicy,
): string {
  if (!policy.trustProxy || !policy.trustedProxies.includes(immediateIp)) return immediateIp;
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded === null) return immediateIp;
  const separator = forwarded.indexOf(",");
  return (separator === -1 ? forwarded : forwarded.slice(0, separator)).trim() || immediateIp;
}
