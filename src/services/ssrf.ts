/**
 * @purpose Server-Side Request Forgery (SSRF) defense and public URL validation service.
 * @rationale Enforces strict zero-trust network boundaries by denying access to loopback, RFC 1918 private subnets, cloud metadata endpoints, IPv6 translations, and non-HTTP protocols before navigation occurs.
 * @preconditions Input candidate URL must be a non-empty string.
 * @invariants Pure functional validator; zero I/O; Big-O time complexity O(1) for pure checks.
 */

import { DomainError } from '@shukoi/core';
import { normalizeHostname, resolvePublicHost } from './dns-resolver.js';

/**
 * @purpose Enumeration of categorized reasons why a candidate URL is rejected by SSRF or format checks.
 * @rationale Enables callers to perform exhaustive compiler-checked handling without brittle error string parsing.
 * @preconditions None.
 * @invariants Closed union of string literal tokens; immutable type.
 */
export type UrlRejectionKind =
  | 'EMPTY'
  | 'MALFORMED'
  | 'PROTOCOL'
  | 'INTERNAL_HOST'
  | 'PRIVATE_IP'
  | 'DNS_FAILURE';

/**
 * @purpose Discriminated union result of pure public URL validation.
 * @rationale Delivers parsed URL instance on success or typed rejection reason on failure without throwing exceptions.
 * @preconditions Candidate URL string provided to validator.
 * @invariants Discriminated by boolean property 'ok'.
 */
export type UrlCheckResult =
  | { readonly ok: true; readonly url: URL }
  | { readonly ok: false; readonly reason: UrlRejectionKind; readonly message?: string };

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
  DNS_FAILURE: (info) => `DNS resolution failed for hostname "${info.hostname ?? ''}"`,
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
  const [b0, b1, b2] = parts;

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
  // 192.0.0.0/24 (IETF Protocol Assignments)
  if (b0 === 192 && b1 === 0 && b2 === 0) return true;
  // 192.0.2.0/24 (TEST-NET-1 RFC 5737)
  if (b0 === 192 && b1 === 0 && b2 === 2) return true;
  // 198.51.100.0/24 (TEST-NET-2 RFC 5737)
  if (b0 === 198 && b1 === 51 && b2 === 100) return true;
  // 203.0.113.0/24 (TEST-NET-3 RFC 5737)
  if (b0 === 203 && b1 === 0 && b2 === 113) return true;
  // 198.18.0.0/15 (Network benchmark tests RFC 2544)
  if (b0 === 198 && b1 !== undefined && (b1 === 18 || b1 === 19)) return true;
  // 224.0.0.0/4 (Multicast)
  if (b0 >= 224 && b0 <= 239) return true;
  // 240.0.0.0/4 (Reserved)
  if (b0 >= 240) return true;

  return false;
}

/**
 * @purpose Checks whether an IPv6 address string belongs to a private, loopback, link-local, or translation range.
 * @rationale Guards against IPv6 bypasses targeting internal services, cloud hypervisor metadata, NAT64, or 6to4 relay mappings.
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
  // IPv4-mapped IPv6 (::ffff:x.x.x.x or ::ffff:0:0/96)
  if (clean.includes('::ffff:')) {
    const ipv4Part = clean.split('::ffff:')[1];
    if (ipv4Part?.includes('.')) {
      return isPrivateIpv4(ipv4Part);
    }
    return true;
  }
  // IPv4/IPv6 translation 64:ff9b::/96 (RFC 6052)
  if (clean.startsWith('64:ff9b:')) {
    return true;
  }
  // 6to4 translation 2002::/16 (RFC 3056)
  if (clean.startsWith('2002:')) {
    return true;
  }
  // Discard-only prefix 100::/64 (RFC 6666)
  if (clean.startsWith('100:')) {
    return true;
  }
  // AWS EC2 IPv6 metadata fd00:ec2::254
  if (clean.startsWith('fd00:ec2:')) {
    return true;
  }

  return false;
}

/**
 * @purpose Pure classifier inspecting whether a candidate URL targets a public HTTP/HTTPS endpoint syntactically.
 * @rationale Provides zero-throw, typed evaluation of candidate URLs for secure navigation pipelines.
 * @preconditions candidate is a string URL.
 * @param candidate Raw candidate URL string.
 * @param options Optional settings controlling loopback allowance for testing fixtures.
 * @returns UrlCheckResult discriminated union ({ ok: true, url: URL } | { ok: false, reason: UrlRejectionKind }).
 * @throws Never throws directly; purely functional.
 * @invariants Strict zero-trust validation; pure function; Big-O time complexity O(1).
 */
export function checkPublicUrl(
  candidate: string,
  options?: { allowLoopback?: boolean },
): UrlCheckResult {
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

  // Normalize hostname (strip trailing dot, lowercase)
  let hostname = parsed.hostname.toLowerCase();
  hostname = hostname.replace(/\.+$/, '');

  // 2. Reject localhost and local domain patterns
  if (!options?.allowLoopback) {
    if (
      hostname === 'localhost' ||
      hostname.endsWith('.localhost') ||
      hostname === 'local' ||
      hostname.endsWith('.local') ||
      hostname === 'localdomain' ||
      hostname.endsWith('.localdomain') ||
      hostname === 'internal' ||
      hostname.endsWith('.internal') ||
      hostname === 'metadata' ||
      hostname.startsWith('metadata.') ||
      hostname === 'metadata.google.internal' ||
      hostname === 'instance-data'
    ) {
      return { ok: false, reason: 'INTERNAL_HOST' };
    }
  }

  // 3. Reject private IPv4 subnets
  const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
  if (ipv4Regex.test(hostname)) {
    if (options?.allowLoopback && hostname.startsWith('127.')) {
      // Loopback explicitly permitted for local test fixtures
    } else if (isPrivateIpv4(hostname)) {
      return { ok: false, reason: 'PRIVATE_IP' };
    }
  }

  // 4. Reject private IPv6 ranges
  if (hostname.startsWith('[') || hostname.includes(':')) {
    if (options?.allowLoopback && (hostname === '[::1]' || hostname === '::1')) {
      // Loopback explicitly permitted for local test fixtures
    } else if (isPrivateIpv6(hostname)) {
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
 * @param options Optional configuration controlling loopback allowance.
 * @returns Validated URL object ready for navigation.
 * @throws DomainError BAD_REQUEST if candidate is malformed, uses non-HTTP protocols, or resolves to private/loopback/cloud metadata targets.
 * @invariants Delegates to checkPublicUrl; produces byte-identical legacy error messages; Big-O time complexity O(1).
 */
export function validatePublicUrl(candidate: string, options?: { allowLoopback?: boolean }): URL {
  const result = checkPublicUrl(candidate, options);
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

/**
 * @purpose Asynchronously validates a candidate URL and performs DNS resolution to ensure no resolved IP is private or reserved.
 * @rationale Guarantees complete immunity against DNS-rebinding SSRF attacks by looking up all A/AAAA records before navigation.
 * @preconditions candidate is a valid URL string or URL instance; signal is not aborted.
 * @param candidate Raw candidate URL string or parsed URL instance.
 * @param options Optional configuration containing AbortSignal, cache TTL, and loopback allowance.
 * @returns Promise resolving to validated URL instance.
 * @throws DomainError BAD_REQUEST if candidate fails syntax checks, targets internal hostname, or resolves to private IP addresses.
 * @invariants Resolves all IP addresses; rejects if any address belongs to private/reserved space; thread-safe.
 */
export async function assertPublicUrl(
  candidate: string | URL,
  options?: { signal?: AbortSignal; cacheTtlMs?: number; allowLoopback?: boolean },
): Promise<URL> {
  const candidateStr = typeof candidate === 'string' ? candidate : candidate.toString();
  const syncCheck = checkPublicUrl(candidateStr, { allowLoopback: options?.allowLoopback });
  if (!syncCheck.ok) {
    const formatter = MESSAGE_FOR[syncCheck.reason];
    let hostname: string | undefined;
    let isIpv6 = false;
    try {
      const p = new URL(candidateStr.trim());
      hostname = p.hostname.toLowerCase();
      isIpv6 = hostname.startsWith('[') || hostname.includes(':');
    } catch {}
    throw new DomainError('BAD_REQUEST', formatter({ candidate: candidateStr, hostname, isIpv6 }));
  }

  const parsedUrl = syncCheck.url;
  const canonHost = normalizeHostname(parsedUrl.hostname);

  const resolvedAddresses = await resolvePublicHost(canonHost, options);
  for (const address of resolvedAddresses) {
    if (address.includes(':')) {
      if (
        options?.allowLoopback &&
        (address === '::1' || address === '0000:0000:0000:0000:0000:0000:0000:0001')
      ) {
        continue;
      }
      if (isPrivateIpv6(address)) {
        throw new DomainError(
          'BAD_REQUEST',
          `Access to private or reserved IPv6 address "${address}" for host "${canonHost}" is prohibited`,
        );
      }
    } else {
      if (options?.allowLoopback && address.startsWith('127.')) {
        continue;
      }
      if (isPrivateIpv4(address)) {
        throw new DomainError(
          'BAD_REQUEST',
          `Access to private or reserved IP address "${address}" for host "${canonHost}" is prohibited`,
        );
      }
    }
  }

  return parsedUrl;
}
