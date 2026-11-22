/**
 * @purpose Server-Side Request Forgery (SSRF) defense and public URL validation service.
 * @rationale Enforces strict zero-trust network boundaries by denying access to loopback, RFC 1918 private subnets, cloud metadata endpoints, and non-HTTP protocols before navigation occurs.
 * @preconditions Input candidate URL must be a non-empty string.
 * @invariants Pure functional validator; zero I/O; Big-O time complexity O(1).
 */

import { DomainError } from '@shukoi/core';

/**
 * @purpose Enumeration of categorized reasons why a candidate URL is rejected by SSRF or format checks.
 * @rationale Enables callers to perform exhaustive compiler-checked handling without brittle error string parsing.
 * @preconditions None.
 * @invariants Closed union of string literal tokens; immutable type.
 */
export type UrlRejectionKind = 'EMPTY' | 'MALFORMED' | 'PROTOCOL' | 'INTERNAL_HOST' | 'PRIVATE_IP';

/**
 * @purpose Discriminated union result of pure public URL validation.
 * @rationale Delivers parsed URL instance on success or typed rejection reason on failure without throwing exceptions.
 * @preconditions Candidate URL string provided to validator.
 * @invariants Discriminated by boolean property 'ok'.
 */
export type UrlCheckResult =
  | { readonly ok: true; readonly url: URL }
  | { readonly ok: false; readonly reason: UrlRejectionKind };

/**
 * @purpose Contextual metadata required for generating legacy-compatible error messages.
 * @rationale Preserves byte-identical DomainError messages when delegating from validatePublicUrl.
 * @preconditions Populated only on URL rejection during throw delegation.
 * @invariants Readonly parameter bundle; Big-O time complexity O(1).
 */
export interface RejectionMessageInfo {
  readonly candidate: string;
  readonly protocol?: string;
  readonly hostname?: string;
  readonly isIpv6?: boolean;
}

/**
 * @purpose Mapping of rejection kind to message formatter generating exact legacy error strings.
 * @rationale Guarantees 100% backward compatibility for validatePublicUrl callers expecting existing exception messages.
 * @preconditions Valid UrlRejectionKind key and populated RejectionMessageInfo.
 * @invariants Big-O time complexity O(1); pure string interpolation.
 */
export const MESSAGE_FOR: Record<UrlRejectionKind, (info: RejectionMessageInfo) => string> = {
  EMPTY: () => 'Target URL must be a non-empty string',
  MALFORMED: (info) => `Malformed URL provided: "${info.candidate}"`,
  PROTOCOL: (info) =>
    `Unsupported protocol: "${info.protocol ?? ''}". Only HTTP and HTTPS are permitted`,
  INTERNAL_HOST: (info) =>
    `Access to internal or local hostname "${info.hostname ?? ''}" is prohibited`,
  PRIVATE_IP: (info) =>
    info.isIpv6
      ? `Access to private or reserved IPv6 address "${info.hostname ?? ''}" is prohibited`
      : `Access to private or reserved IP address "${info.hostname ?? ''}" is prohibited`,
};

/**
 * @purpose Checks whether a numerical IPv4 address belongs to a reserved or private subnet.
 * @rationale Prevents internal service scanning and lateral movement to internal network infrastructure.
 * @preconditions ip is a dotted-decimal IPv4 string (e.g., "192.168.1.1").
 * @param ip Dotted-decimal IPv4 address string.
 * @returns Boolean true if the IP belongs to a private/reserved subnet, false otherwise.
 * @throws Never throws directly.
 * @invariants Pure arithmetic evaluation; Big-O time complexity O(1).
 */
export function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split('.').map((p) => Number.parseInt(p, 10));
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) {
    return true;
  }
  const [b0, b1] = parts;

  // 0.0.0.0/8 (Current network)
  if (b0 === 0) return true;
  // 10.0.0.0/8 (Private-Use RFC 1918)
  if (b0 === 10) return true;
  // 127.0.0.0/8 (Loopback)
  if (b0 === 127) return true;
  // 169.254.0.0/16 (Link-Local, AWS/GCP Metadata 169.254.169.254)
  if (b0 === 169 && b1 === 254) return true;
  // 172.16.0.0/12 (Private-Use RFC 1918)
  if (b0 === 172 && b1 !== undefined && b1 >= 16 && b1 <= 31) return true;
  // 192.168.0.0/16 (Private-Use RFC 1918)
  if (b0 === 192 && b1 === 168) return true;
  // 100.64.0.0/10 (Shared Address Space RFC 6598)
  if (b0 === 100 && b1 !== undefined && b1 >= 64 && b1 <= 127) return true;
  // 224.0.0.0/4 (Multicast)
  if (b0 >= 224 && b0 <= 239) return true;
  // 240.0.0.0/4 (Reserved)
  if (b0 >= 240) return true;

  return false;
}

/**
 * @purpose Checks whether an IPv6 address string belongs to a private, loopback, or link-local range.
 * @rationale Guards against IPv6 bypasses targeting internal services or cloud hypervisor metadata.
 * @preconditions ipv6 is a normalized or bracketed IPv6 string.
 * @param ipv6 IPv6 address string.
 * @returns Boolean true if the address is reserved, loopback, or private, false otherwise.
 * @throws Never throws directly.
 * @invariants Pure string analysis; Big-O time complexity O(1).
 */
export function isPrivateIpv6(ipv6: string): boolean {
  const clean = ipv6.replace(/^\[|\]$/g, '').toLowerCase();

  // Loopback (::1) and Unspecified (::)
  if (clean === '::1' || clean === '::' || clean === '0000:0000:0000:0000:0000:0000:0000:0001') {
    return true;
  }
  // Unique Local Address fc00::/7 (fc00... - fdff...)
  if (clean.startsWith('fc') || clean.startsWith('fd')) {
    return true;
  }
  // Link-Local fe80::/10 (fe80... - febf...)
  if (
    clean.startsWith('fe8') ||
    clean.startsWith('fe9') ||
    clean.startsWith('fea') ||
    clean.startsWith('feb')
  ) {
    return true;
  }
  // IPv4-mapped IPv6 (::ffff:x.x.x.x)
  if (clean.includes('::ffff:')) {
    const ipv4Part = clean.split('::ffff:')[1];
    if (ipv4Part?.includes('.')) {
      return isPrivateIpv4(ipv4Part);
    }
    return true;
  }

  return false;
}

/**
 * @purpose Pure classifier inspecting whether a candidate URL targets a public HTTP/HTTPS endpoint.
 * @rationale Provides zero-throw, typed evaluation of candidate URLs for secure navigation pipelines.
 * @preconditions candidate is a string URL.
 * @param candidate Raw candidate URL string.
 * @returns UrlCheckResult discriminated union ({ ok: true, url: URL } | { ok: false, reason: UrlRejectionKind }).
 * @throws Never throws directly; purely functional.
 * @invariants Strict zero-trust validation; pure function; Big-O time complexity O(1).
 */
export function checkPublicUrl(candidate: string): UrlCheckResult {
  if (!candidate || typeof candidate !== 'string' || candidate.trim() === '') {
    return { ok: false, reason: 'EMPTY' };
  }

  let parsed: URL;
  try {
    parsed = new URL(candidate.trim());
  } catch {
    return { ok: false, reason: 'MALFORMED' };
  }

  // 1. Enforce strict HTTP/HTTPS protocols
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, reason: 'PROTOCOL' };
  }

  const hostname = parsed.hostname.toLowerCase();

  // 2. Reject localhost and local domain patterns
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname === 'local' ||
    hostname.endsWith('.local') ||
    hostname === 'metadata.google.internal' ||
    hostname === 'instance-data'
  ) {
    return { ok: false, reason: 'INTERNAL_HOST' };
  }

  // 3. Reject private IPv4 subnets
  const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
  if (ipv4Regex.test(hostname)) {
    if (isPrivateIpv4(hostname)) {
      return { ok: false, reason: 'PRIVATE_IP' };
    }
  }

  // 4. Reject private IPv6 ranges
  if (hostname.startsWith('[') || hostname.includes(':')) {
    if (isPrivateIpv6(hostname)) {
      return { ok: false, reason: 'PRIVATE_IP' };
    }
  }

  return { ok: true, url: parsed };
}

/**
 * @purpose Validates that a candidate URL targets a legitimate, publicly accessible HTTP/HTTPS endpoint.
 * @rationale Shields web research crawlers from SSRF exploits, local port scanning, and cloud metadata theft, throwing DomainError on violation.
 * @preconditions candidate is a non-empty string URL.
 * @param candidate Raw candidate URL string.
 * @returns Validated URL object ready for navigation.
 * @throws DomainError BAD_REQUEST if candidate is malformed, uses non-HTTP protocols, or resolves to private/loopback/cloud metadata targets.
 * @invariants Delegates to checkPublicUrl; produces byte-identical legacy error messages; Big-O time complexity O(1).
 */
export function validatePublicUrl(candidate: string): URL {
  const result = checkPublicUrl(candidate);
  if (result.ok) {
    return result.url;
  }

  let info: RejectionMessageInfo = { candidate };
  if (
    result.reason === 'PROTOCOL' ||
    result.reason === 'INTERNAL_HOST' ||
    result.reason === 'PRIVATE_IP'
  ) {
    try {
      const parsed = new URL(candidate.trim());
      const hostname = parsed.hostname.toLowerCase();
      const isIpv6 = hostname.startsWith('[') || hostname.includes(':');
      info = {
        candidate,
        protocol: parsed.protocol,
        hostname,
        isIpv6,
      };
    } catch {
      // Invariant: parsed URL was already successful in checkPublicUrl
    }
  }

  const formatter = MESSAGE_FOR[result.reason];
  throw new DomainError('BAD_REQUEST', formatter(info));
}
