/**
 * @purpose Server-Side Request Forgery (SSRF) defense and public URL validation service.
 * @rationale Enforces strict zero-trust network boundaries by denying access to loopback, RFC 1918 private subnets, cloud metadata endpoints, and non-HTTP protocols before navigation occurs.
 * @preconditions Input candidate URL must be a non-empty string.
 * @invariants Pure functional validator; zero I/O; Big-O time complexity O(1).
 */

import { DomainError } from '@shukoi/core';

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
 * @purpose Validates that a candidate URL targets a legitimate, publicly accessible HTTP/HTTPS endpoint.
 * @rationale Shields web research crawlers from SSRF exploits, local port scanning, and cloud metadata theft.
 * @preconditions candidate is a non-empty string URL.
 * @param candidate Raw candidate URL string.
 * @returns Validated URL object ready for navigation.
 * @throws DomainError BAD_REQUEST if candidate is malformed, uses non-HTTP protocols, or resolves to private/loopback/cloud metadata targets.
 * @invariants Strict zero-trust validation; pure function; Big-O time complexity O(1).
 */
export function validatePublicUrl(candidate: string): URL {
  if (!candidate || typeof candidate !== 'string' || candidate.trim() === '') {
    throw new DomainError('BAD_REQUEST', 'Target URL must be a non-empty string');
  }

  let parsed: URL;
  try {
    parsed = new URL(candidate.trim());
  } catch {
    throw new DomainError('BAD_REQUEST', `Malformed URL provided: "${candidate}"`);
  }

  // 1. Enforce strict HTTP/HTTPS protocols
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new DomainError(
      'BAD_REQUEST',
      `Unsupported protocol: "${parsed.protocol}". Only HTTP and HTTPS are permitted`,
    );
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
    throw new DomainError(
      'BAD_REQUEST',
      `Access to internal or local hostname "${hostname}" is prohibited`,
    );
  }

  // 3. Reject private IPv4 subnets
  const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
  if (ipv4Regex.test(hostname)) {
    if (isPrivateIpv4(hostname)) {
      throw new DomainError(
        'BAD_REQUEST',
        `Access to private or reserved IP address "${hostname}" is prohibited`,
      );
    }
  }

  // 4. Reject private IPv6 ranges
  if (hostname.startsWith('[') || hostname.includes(':')) {
    if (isPrivateIpv6(hostname)) {
      throw new DomainError(
        'BAD_REQUEST',
        `Access to private or reserved IPv6 address "${hostname}" is prohibited`,
      );
    }
  }

  return parsed;
}
