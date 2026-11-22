/**
 * @purpose Asynchronous DNS resolution service with LRU caching and hostname normalization.
 * @rationale Validates that domain names resolve to legitimate public IP addresses before browser network requests are permitted, closing DNS-rebinding and dynamic SSRF bypasses.
 * @preconditions Network access to configured DNS resolvers; node:dns module available.
 * @invariants LRU cache bounded at 512 entries; thread-safe async lookups; zero leaks.
 */

import dns from 'node:dns/promises';
import { DomainError } from '@shukoi/core';

/**
 * @purpose Internal cache entry storing resolved IP addresses and expiration timestamp.
 * @rationale Implements TTL-based eviction for cached DNS lookups to balance performance with DNS cache invalidation.
 * @invariants Immutable address array; expiration timestamp in milliseconds.
 */
interface DnsCacheEntry {
  readonly addresses: readonly string[];
  readonly expiresAt: number;
}

const MAX_CACHE_ENTRIES = 512;
const dnsCache = new Map<string, DnsCacheEntry>();

/**
 * @purpose Normalizes a raw hostname string into a canonical, lowercase, trailing-dot-stripped ASCII punycode representation.
 * @rationale Eliminates casing discrepancies, trailing-dot FQDN bypasses (e.g. "localhost."), and internationalized domain spoofing (IDN).
 * @preconditions rawHostname is a non-empty string.
 * @param rawHostname Raw hostname string from URL or user input.
 * @returns Clean, canonical hostname string.
 * @throws DomainError BAD_REQUEST if hostname is malformed or invalid.
 * @invariants Pure function; Big-O time complexity O(1); deterministic output.
 */
export function normalizeHostname(rawHostname: string): string {
  if (!rawHostname || typeof rawHostname !== 'string' || rawHostname.trim() === '') {
    throw new DomainError('BAD_REQUEST', 'Hostname cannot be empty');
  }

  let normalized = rawHostname.trim().toLowerCase();
  // Strip trailing dots (e.g. "localhost." -> "localhost")
  normalized = normalized.replace(/\.+$/, '');

  if (!normalized) {
    throw new DomainError('BAD_REQUEST', 'Hostname cannot be empty after trimming');
  }

  // Punycode conversion using standard URL constructor helper
  try {
    const dummy = new URL(`http://${normalized}`);
    return dummy.hostname.toLowerCase();
  } catch {
    return normalized;
  }
}

/**
 * @purpose Determines if a hostname string represents a direct IPv4 or IPv6 address literal.
 * @rationale Avoids redundant DNS lookups for IP literals and routes them directly to IP subnet checkers.
 * @preconditions hostname must be a normalized string.
 * @param hostname Hostname string to inspect.
 * @returns True if hostname is an IPv4 or IPv6 literal, false otherwise.
 * @throws Never throws directly.
 * @invariants Pure string check; Big-O time complexity O(1).
 */
export function isIpLiteral(hostname: string): boolean {
  const clean = hostname.replace(/^\[|\]$/g, '');
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(clean)) {
    return true;
  }
  if (clean.includes(':')) {
    return true;
  }
  return false;
}

/**
 * @purpose Clears the in-memory DNS resolution cache.
 * @rationale Facilitates test isolation and manual cache flushing across test suites.
 * @preconditions None.
 * @param None.
 * @returns Void.
 * @throws Never throws.
 * @invariants Cache map size becomes 0; Big-O time complexity O(1).
 */
export function clearDnsCache(): void {
  dnsCache.clear();
}

/**
 * @purpose Options parameterizing the DNS resolution lookup.
 * @rationale Permits callers to pass cancellation signals and custom cache TTL bounds.
 * @invariants Readonly options object.
 */
export interface ResolveDnsOptions {
  readonly signal?: AbortSignal;
  readonly cacheTtlMs?: number;
}

/**
 * @purpose Resolves a hostname to all associated public A (IPv4) and AAAA (IPv6) addresses.
 * @rationale Ensures that multi-homed domain names and dynamic DNS entries are exhaustively inspected against private and reserved IP ranges prior to navigation.
 * @preconditions hostname is a non-empty string; signal is not aborted.
 * @param hostname Target hostname or domain string.
 * @param options Optional ResolveDnsOptions controlling cancellation and cache TTL.
 * @returns Promise resolving to an array of resolved IP address strings.
 * @throws DomainError BAD_REQUEST if hostname cannot be resolved (ENOTFOUND), or operation is aborted.
 * @invariants LRU eviction enforces <= 512 entries; Big-O time complexity O(1) cache lookup, O(network) for live DNS.
 */
export async function resolvePublicHost(
  hostname: string,
  options?: ResolveDnsOptions,
): Promise<readonly string[]> {
  const signal = options?.signal;
  if (signal?.aborted) {
    throw new DomainError('BAD_REQUEST', 'Operation cancelled prior to DNS resolution');
  }

  const canonHost = normalizeHostname(hostname);

  // If already an IP literal, return as single element array
  if (isIpLiteral(canonHost)) {
    const cleanIp = canonHost.replace(/^\[|\]$/g, '');
    return Object.freeze([cleanIp]);
  }

  const ttl = options?.cacheTtlMs ?? 60000;
  const now = Date.now();

  // Check LRU cache
  const cached = dnsCache.get(canonHost);
  if (cached) {
    if (cached.expiresAt > now) {
      // Re-insert to refresh LRU order
      dnsCache.delete(canonHost);
      dnsCache.set(canonHost, cached);
      return cached.addresses;
    }
    dnsCache.delete(canonHost);
  }

  // Live DNS lookup for all A and AAAA records
  try {
    const lookupResults = await dns.lookup(canonHost, {
      all: true,
      verbatim: true,
    });

    if (!lookupResults || lookupResults.length === 0) {
      throw new DomainError('BAD_REQUEST', `DNS lookup produced no records for "${canonHost}"`);
    }

    const addresses = Object.freeze(lookupResults.map((r) => r.address));

    // Enforce LRU cache capacity limit
    if (dnsCache.size >= MAX_CACHE_ENTRIES) {
      const oldestKey = dnsCache.keys().next().value;
      if (oldestKey) {
        dnsCache.delete(oldestKey);
      }
    }

    dnsCache.set(canonHost, {
      addresses,
      expiresAt: now + ttl,
    });

    return addresses;
  } catch (err: unknown) {
    if (signal?.aborted) {
      throw new DomainError('BAD_REQUEST', 'DNS resolution cancelled by caller');
    }
    if (err instanceof DomainError) {
      throw err;
    }
    const msg = err instanceof Error ? err.message : String(err);
    throw new DomainError(
      'BAD_REQUEST',
      `DNS resolution failed for hostname "${canonHost}": ${msg}`,
    );
  }
}
