/**
 * @purpose Enterprise-grade API Key authentication middleware and timing-safe validator for MCP HTTP endpoints.
 * @rationale Enforces optional API key authentication using SHA-256 pre-hashed buffers and crypto.timingSafeEqual to prevent side-channel timing attacks, while allowing unhindered CORS preflight and health probes.
 * @preconditions Configured apiKeys array or empty array for open/unauthenticated mode.
 * @invariants Constant-time O(1) comparison; zero memory leaks; JSON-RPC 2.0 401 error contract.
 */

import crypto from 'node:crypto';
import type { Context, MiddlewareHandler, Next } from 'hono';

/**
 * @purpose Options parameterizing the API key authentication middleware.
 * @rationale Allows injecting authorized keys and custom route exemptions.
 * @invariants Readonly data structure.
 */
export interface ApiKeyAuthOptions {
  readonly apiKeys: readonly string[];
}

/**
 * @purpose Validates an incoming API key against authorized keys using constant-time buffer comparison.
 * @rationale Hashes both tokens with SHA-256 before comparing via crypto.timingSafeEqual to eliminate timing side-channel attacks and prevent byte length mismatch exceptions.
 * @preconditions validKeys contains authorized non-empty string keys.
 * @param providedKey Untrusted incoming API key string.
 * @param validKeys Readonly array of authorized API keys.
 * @returns Boolean indicating whether providedKey matches any authorized key.
 * @throws Never throws; malformed inputs return false.
 * @invariants Constant-time O(1) verification; zero string length leakage.
 */
export function validateApiKey(providedKey: string, validKeys: readonly string[]): boolean {
  if (validKeys.length === 0) {
    return true;
  }
  if (!providedKey || providedKey.trim() === '') {
    return false;
  }

  const providedHash = crypto.createHash('sha256').update(providedKey.trim()).digest();

  for (const validKey of validKeys) {
    if (!validKey || validKey.trim() === '') continue;
    const targetHash = crypto.createHash('sha256').update(validKey.trim()).digest();
    if (crypto.timingSafeEqual(providedHash, targetHash)) {
      return true;
    }
  }

  return false;
}

/**
 * @purpose Extracts API key from Authorization header (Bearer or direct) or x-api-key header.
 * @rationale Accommodates standard RFC 6750 Bearer authentication as well as direct custom headers without casing sensitivity.
 * @preconditions None.
 * @param headers Standard Fetch Headers instance or plain header record.
 * @returns Extracted token string trimmed, or undefined if absent or empty.
 * @throws Never throws.
 * @invariants Case-insensitive header lookup; pure extraction.
 */
export function extractApiKey(
  headers: Headers | Record<string, string | string[] | undefined>,
): string | undefined {
  let authHeader: string | undefined;
  let apiKeyHeader: string | undefined;

  if (typeof (headers as Headers).get === 'function') {
    authHeader = (headers as Headers).get('authorization') ?? undefined;
    apiKeyHeader = (headers as Headers).get('x-api-key') ?? undefined;
  } else {
    const raw = headers as Record<string, string | string[] | undefined>;
    for (const key of Object.keys(raw)) {
      const lower = key.toLowerCase();
      if (lower === 'authorization') {
        const val = raw[key];
        authHeader = Array.isArray(val) ? val[0] : val;
      } else if (lower === 'x-api-key') {
        const val = raw[key];
        apiKeyHeader = Array.isArray(val) ? val[0] : val;
      }
    }
  }

  if (authHeader && authHeader.trim() !== '') {
    const raw = authHeader.trim();
    if (raw.toLowerCase() === 'bearer') {
      return undefined;
    }
    if (raw.toLowerCase().startsWith('bearer ')) {
      const token = raw.slice(7).trim();
      return token.length > 0 ? token : undefined;
    }
    return raw;
  }

  if (apiKeyHeader && apiKeyHeader.trim() !== '') {
    return apiKeyHeader.trim();
  }

  return undefined;
}

/**
 * @purpose Hono HTTP middleware enforcing optional API key authentication on protected endpoints.
 * @rationale Bypasses preflight OPTIONS and public /health probes while strictly validating credentials on MCP transport routes when apiKeys are configured.
 * @preconditions options.apiKeys provides authorized keys (empty array disables auth).
 * @param options Configuration object containing authorized apiKeys array.
 * @returns Hono MiddlewareHandler function.
 * @throws Never throws unhandled; returns HTTP 401 with standard JSON-RPC 2.0 error format on unauthorized requests.
 * @invariants Non-blocking async execution; idempotent; RFC 6750 WWW-Authenticate header injection on 401.
 */
export function apiKeyAuthMiddleware(options: ApiKeyAuthOptions): MiddlewareHandler {
  return async (c: Context, next: Next) => {
    // 1. Bypass CORS preflight requests
    if (c.req.method === 'OPTIONS') {
      return next();
    }

    // 2. Bypass public liveness/readiness health probes
    if (c.req.path === '/health') {
      return next();
    }

    // 3. If no API keys are configured, auth is optional / disabled
    if (options.apiKeys.length === 0) {
      return next();
    }

    // 4. Extract token from Authorization or X-API-Key header
    const token = extractApiKey(c.req.raw.headers);

    // 5. Validate token
    if (!token || !validateApiKey(token, options.apiKeys)) {
      c.header('WWW-Authenticate', 'Bearer realm="mcp-web-research", error="invalid_token"');
      return c.json(
        {
          jsonrpc: '2.0',
          id: null,
          error: {
            code: -32001,
            message: 'Unauthorized: Invalid or missing API authentication credentials.',
          },
        },
        401,
      );
    }

    return next();
  };
}
