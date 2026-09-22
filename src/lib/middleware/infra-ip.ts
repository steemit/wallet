/**
 * Forensic infrastructure-IP self-check for the recovery request flow.
 *
 * A real user's recovery request never originates from an internal address.
 * When arecs.remote_ip lands in these ranges, the reverse proxy's realip
 * chain failed to resolve the true client (config drift, an untrusted hop,
 * or a direct-to-ALB bypass) and the recorded IP has no forensic value.
 * Detection is warn-only by design: availability of the recovery path
 * outweighs the evidence loss (see the recovery/request route).
 *
 * Ranges: RFC1918, IPv4 loopback, IPv4 link-local (169.254/16 — includes the
 * EC2 instance-metadata address), IPv6 loopback, IPv6 ULA (fc00::/7), IPv6
 * link-local (fe80::/10), and IPv4-mapped IPv6 addresses whose mapped IPv4
 * falls in those ranges. None of these can be a genuine public client, so
 * the check has no false-positive surface.
 */

const INFRA_IPV4_PREFIX =
  /^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.)/;
const INFRA_IPV6_PREFIX = /^(::1$|f[cd][0-9a-f]{2}:|fe[89ab][0-9a-f]:)/i;

// ::ffff:a.b.c.d — the dotted form of the IPv4-mapped block ::ffff:0:0/96,
// which is what proxy chains typically emit when the resolved client was an
// IPv4 address. Only this canonical dotted form is treated as a mapping; a
// mapped PUBLIC IPv4 (e.g. ::ffff:8.8.8.8) is still a public client, so the
// prefix alone is never enough — the embedded IPv4 must be tested.
const IPV4_MAPPED_IPV6 = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i;

/**
 * Whether the IP looks like infrastructure rather than a real client.
 * Handles plain IPv4, plain IPv6, and IPv4-mapped IPv6 (the mapped IPv4 is
 * extracted and tested against the IPv4 ranges).
 */
export function isInfrastructureIp(ip: string): boolean {
  const value = ip.trim().toLowerCase();
  if (INFRA_IPV4_PREFIX.test(value) || INFRA_IPV6_PREFIX.test(value)) return true;
  const mapped = value.match(IPV4_MAPPED_IPV6);
  if (mapped?.[1]) return INFRA_IPV4_PREFIX.test(mapped[1]);
  return false;
}
