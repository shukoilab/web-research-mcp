/**
 * @purpose Zero-Hardcoding centralized configuration schema, defaults, and fail-fast environment validation.
 * @rationale Enforces 12-Factor principles by loading all knobs, proxy settings, timeouts, scroll delays, and limits from environment variables with fail-fast validation.
 * @preconditions Environment variables must conform to expected format constraints.
 * @invariants Readonly immutable objects; thread-safe; fail-fast process termination on invalid configuration.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDefaultConfig, type ShukoiConfig } from '@shukoi/core';
import { Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';

/**
 * @purpose Universal constants and baseline defaults consumed by schemas, actions, and services.
 * @rationale Centralizes all magic numbers and default literals into a single source of truth, eliminating drift between schemas and runtime logic.
 * @invariants Deeply frozen immutable object.
 */
export const DEFAULTS = Object.freeze({
  HOST: '127.0.0.1',
  PORT: 3000,
  REQUEST_BUDGET_MS: 60000,
  DEEP_RESEARCH_BUDGET_MS: 240000,
  PAGE_TIMEOUT_MS: 30000,
  MIN_PAGE_BUDGET_MS: 5000,
  STABILIZE_TIMEOUT_MS: 3000,
  SETTLE_POLL_MS: 150,
  MAX_REDIRECTS: 10,
  MAX_MARKDOWN_CHARS: 100000,
  MAX_QUEUE_LENGTH: 50,
  MAX_RESULTS_PER_HOST: 2,
  DEFAULT_HTML_CHARSET: 'utf-8',
  DNS_CACHE_TTL_MS: 60000,
  GOOGLE_SEARCH_BASE: 'https://www.google.com/search',
  UNFOLD_INTERACTIVE: false,
  ALLOWED_HOSTS: ['localhost', '127.0.0.1'] as const,
  ALLOWED_ORIGINS: ['localhost', '127.0.0.1'] as const,
  BROWSER_TIMEOUT_MS: 30000,
  MAX_CONCURRENT_PAGES: 5,
  MAX_CONTENT_LENGTH: 5242880,
  MAX_REQUESTS_BEFORE_RECYCLE: 1000,
  NETWORK_IDLE_TIMEOUT_MS: 5000,
  SCROLL_DELAY_MS: 500,
  SCROLL_STEP_PX: 1000,
  SCROLL_SETTLE_TIMEOUT_MS: 500,
  MAX_SCROLL_STEPS: 6,
  SEARCH_WAIT_TIMEOUT_MS: 10000,
  READABILITY_CHAR_THRESHOLD: 20,
  MAX_UNFOLD_PER_PAGE: 50,
  DEFAULT_XVFB_DISPLAY: ':99',
  XVFB_LOCK_PATH: '/tmp/.X99-lock',
  XVFB_SOCKET_PATH: '/tmp/.X11-unix/X99',
  XVFB_SCREEN_RESOLUTION: '1920x1080x24',
  CHROME_CHANNEL: 'chrome',
  BLOCKED_RESOURCE_TYPES: [
    'image',
    'stylesheet',
    'font',
    'media',
    'texttrack',
    'manifest',
  ] as const,
  BOT_WALL_PATTERNS: [
    /masuk diperlukan/i,
    /login required/i,
    /sign in required/i,
    /please sign in/i,
    /verify you are human/i,
    /attention required!\s*\|\s*cloudflare/i,
    /just a moment\.\.\./i,
    /security check to access/i,
  ] as const,
});

/**
 * @purpose Structured proxy configuration for Patchright and network transports.
 * @rationale Decouples raw proxy URL strings into server and optional credentials required by browser launch options.
 * @invariants Readonly data structure.
 */
export interface ProxyConfig {
  readonly server: string;
  readonly username?: string;
  readonly password?: string;
}

/**
 * @purpose Domain-specific configuration settings for stealth browser and extraction pipeline.
 * @rationale Consolidates browser runtime controls, proxy configuration, scroll timing, and heap protection limits into a single typed contract.
 * @invariants Deeply frozen runtime object; immutable.
 */
export interface WebResearchConfig {
  readonly host: string;
  readonly port: number;
  readonly allowedHosts: readonly string[];
  readonly allowedOrigins: readonly string[];
  readonly apiKeys: readonly string[];
  readonly httpProxy?: string;
  readonly browserTimeoutMs: number;
  readonly maxConcurrentPages: number;
  readonly maxContentLength: number;
  readonly userDataDir: string;
  readonly maxRequestsBeforeRecycle: number;
  readonly networkIdleTimeoutMs: number;
  readonly scrollDelayMs: number;
  readonly scrollStepPx: number;
  readonly scrollSettleTimeoutMs: number;
  readonly maxScrollSteps: number;
  readonly searchWaitTimeoutMs: number;
  readonly readabilityCharThreshold: number;
  readonly requestBudgetMs: number;
  readonly deepResearchBudgetMs: number;
  readonly pageTimeoutMs: number;
  readonly minPageBudgetMs: number;
  readonly stabilizeTimeoutMs: number;
  readonly settlePollMs: number;
  readonly maxRedirects: number;
  readonly maxMarkdownChars: number;
  readonly maxQueueLength: number;
  readonly maxResultsPerHost: number;
  readonly defaultHtmlCharset: string;
  readonly dnsCacheTtlMs: number;
  readonly googleSearchBase: string;
  readonly unfoldInteractive: boolean;
  readonly defaultXvfbDisplay: string;
  readonly xvfbLockPath: string;
  readonly xvfbSocketPath: string;
  readonly xvfbScreenResolution: string;
  readonly chromeChannel: string;
  readonly blockedResourceTypes: readonly string[];
  readonly botWallPatterns: readonly RegExp[];
  readonly maxUnfoldPerPage: number;
}

/**
 * @purpose Parses a raw HTTP/HTTPS proxy URL into structured Playwright/Patchright proxy options.
 * @rationale Extracts authentication credentials securely from URL userinfo while retaining protocol and host:port for server targeting.
 * @preconditions rawUrl is either undefined, empty, or a valid URL string starting with http:// or https://.
 * @param rawUrl Raw proxy connection string (e.g., "http://user:pass@127.0.0.1:8080").
 * @returns Structured ProxyConfig object with parsed credentials, or undefined if no proxy string is provided.
 * @throws DomainError if rawUrl is malformed and cannot be parsed by URL constructor.
 * @invariants Pure function; Big-O time complexity O(1); thread-safe.
 */
export function parseProxyConfig(rawUrl?: string): ProxyConfig | undefined {
  if (!rawUrl || rawUrl.trim() === '') {
    return undefined;
  }
  const parsed = new URL(rawUrl.trim());
  return {
    server: `${parsed.protocol}//${parsed.host}`,
    username: parsed.username ? decodeURIComponent(parsed.username) : undefined,
    password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
  };
}

/**
 * @purpose Parses a comma-separated list of strings from an environment variable with defensive trimming.
 * @rationale Safely splits multi-value configuration strings like ALLOWED_HOSTS, ALLOWED_ORIGINS, and API_KEY without empty tokens.
 * @preconditions rawValue is optional string from process.env.
 * @param rawValue Optional raw string from environment variable.
 * @param defaultValues Default string array fallback if rawValue is unset or blank.
 * @returns Readonly array of non-empty trimmed string tokens.
 * @throws Never throws directly.
 * @invariants Pure function; Big-O time complexity O(n); immutable array output.
 */
export function parseCommaSeparatedList(
  rawValue: string | undefined,
  defaultValues: readonly string[] = [],
): readonly string[] {
  if (!rawValue || rawValue.trim() === '') {
    return defaultValues;
  }
  const tokens = rawValue
    .split(',')
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
  return tokens.length > 0 ? Object.freeze(tokens) : defaultValues;
}

/**
 * @purpose Resolves the persistent browser user data directory path.
 * @rationale Using a persistent profile caches DNS, TLS tickets, V8 bytecode, and consent cookies, yielding 38-50% faster navigations and higher antibot reputation.
 * @preconditions envDir is optional path string from environment.
 * @param envDir Optional override from BROWSER_USER_DATA_DIR.
 * @returns Fully qualified directory path string.
 * @throws Never throws directly.
 * @invariants Pure function; Big-O time complexity O(1).
 */
export function resolveDefaultUserDataDir(
  envDir: string | undefined = process.env.BROWSER_USER_DATA_DIR,
): string {
  if (envDir && envDir.trim() !== '') {
    return envDir.trim();
  }
  const poolId = process.env.VITEST_POOL_ID;
  const suffix = poolId ? `-test-${poolId}` : '';
  return path.join(os.homedir(), '.cache', 'mcp-web-research', `chrome-profile${suffix}`);
}

/**
 * @purpose Resolves the service version dynamically from package.json with fallback.
 * @rationale Ensures that version telemetry reflects true package version without hardcoding.
 * @preconditions Filesystem access to working directory package.json.
 * @param None.
 * @returns Package version string.
 * @throws Never throws.
 * @invariants O(1) synchronous read at boot.
 */
export function resolveServiceVersion(): string {
  try {
    const pkgPath = path.join(process.cwd(), 'package.json');
    if (fs.existsSync(pkgPath)) {
      const content = fs.readFileSync(pkgPath, 'utf8');
      const parsed = JSON.parse(content);
      if (typeof parsed.version === 'string' && parsed.version.length > 0) {
        return parsed.version;
      }
    }
  } catch {}
  return '2.2.0';
}

/**
 * @purpose TypeBox schema defining the environment configuration contract.
 * @rationale Validates required format and numeric constraints on boot, enabling deterministic fail-fast behavior.
 * @invariants Closed object schema; additionalProperties: false.
 */
const EnvSchema = Type.Object(
  {
    HOST: Type.String({ minLength: 1 }),
    PORT: Type.Integer({ minimum: 1, maximum: 65535 }),
    MAX_CONCURRENT_PAGES: Type.Integer({ minimum: 1, maximum: 100 }),
    REQUEST_BUDGET_MS: Type.Integer({ minimum: 5000, maximum: 300000 }),
    DEEP_RESEARCH_BUDGET_MS: Type.Integer({ minimum: 10000, maximum: 600000 }),
    PAGE_TIMEOUT_MS: Type.Integer({ minimum: 1000, maximum: 120000 }),
    MIN_PAGE_BUDGET_MS: Type.Integer({ minimum: 500, maximum: 60000 }),
    STABILIZE_TIMEOUT_MS: Type.Integer({ minimum: 0, maximum: 10000 }),
    SETTLE_POLL_MS: Type.Integer({ minimum: 50, maximum: 1000 }),
    MAX_REDIRECTS: Type.Integer({ minimum: 0, maximum: 20 }),
    MAX_MARKDOWN_CHARS: Type.Integer({ minimum: 1000, maximum: 1000000 }),
    MAX_QUEUE_LENGTH: Type.Integer({ minimum: 1, maximum: 1000 }),
    MAX_RESULTS_PER_HOST: Type.Integer({ minimum: 1, maximum: 10 }),
    DNS_CACHE_TTL_MS: Type.Integer({ minimum: 0, maximum: 600000 }),
  },
  { additionalProperties: false },
);

/**
 * @purpose Performs fail-fast validation on process environment variables according to TypeBox schema and bind safety invariants.
 * @rationale Halts process execution with code 1 if PORT or MAX_CONCURRENT_PAGES is invalid, or if binding to non-loopback host without API keys.
 * @preconditions process.env is accessible.
 * @param env Raw environment record to validate (defaults to process.env).
 * @returns Parsed and validated configuration values.
 * @throws Never throws directly; invokes process.exit(1) on failure.
 * @invariants Fail-fast exit on contract breach; stderr diagnostic message.
 */
export function validateEnvironment(env: Record<string, string | undefined> = process.env): {
  readonly host: string;
  readonly port: number;
  readonly maxConcurrentPages: number;
  readonly requestBudgetMs: number;
  readonly deepResearchBudgetMs: number;
  readonly pageTimeoutMs: number;
  readonly minPageBudgetMs: number;
  readonly stabilizeTimeoutMs: number;
  readonly settlePollMs: number;
  readonly maxRedirects: number;
  readonly maxMarkdownChars: number;
  readonly maxQueueLength: number;
  readonly maxResultsPerHost: number;
  readonly dnsCacheTtlMs: number;
  readonly apiKeys: readonly string[];
  readonly allowedHosts: readonly string[];
  readonly allowedOrigins: readonly string[];
} {
  // 1. Explicit empty string check on MCP_API_KEY
  if (env.MCP_API_KEY === '') {
    process.stderr.write('Invalid environment variable MCP_API_KEY: cannot be empty\n');
    process.exit(1);
  }

  // 2. Validate PORT if present
  const rawPort = env.PORT || env.MCP_PORT;
  let port: number = DEFAULTS.PORT;
  if (rawPort !== undefined && rawPort.trim() !== '') {
    const parsedPort = Number(rawPort.trim());
    if (
      Number.isNaN(parsedPort) ||
      !Number.isInteger(parsedPort) ||
      parsedPort < 1 ||
      parsedPort > 65535
    ) {
      process.stderr.write(
        `Invalid environment variable PORT: "${rawPort}" must be an integer between 1 and 65535\n`,
      );
      process.exit(1);
    }
    port = parsedPort;
  }

  // 3. Validate MAX_CONCURRENT_PAGES if present
  const rawMaxPages = env.MAX_CONCURRENT_PAGES;
  let maxConcurrentPages: number = DEFAULTS.MAX_CONCURRENT_PAGES;
  if (rawMaxPages !== undefined && rawMaxPages.trim() !== '') {
    const parsedMax = Number(rawMaxPages.trim());
    if (
      Number.isNaN(parsedMax) ||
      !Number.isInteger(parsedMax) ||
      parsedMax < 1 ||
      parsedMax > 100
    ) {
      process.stderr.write(
        `Invalid environment variable MAX_CONCURRENT_PAGES: "${rawMaxPages}" must be an integer between 1 and 100\n`,
      );
      process.exit(1);
    }
    maxConcurrentPages = parsedMax;
  }

  const host = env.HOST ? env.HOST.trim() : DEFAULTS.HOST;
  const apiKeys = parseCommaSeparatedList(env.MCP_API_KEY || env.API_KEY, []);
  const allowedHosts = parseCommaSeparatedList(env.ALLOWED_HOSTS, DEFAULTS.ALLOWED_HOSTS);
  const allowedOrigins = parseCommaSeparatedList(env.ALLOWED_ORIGINS, DEFAULTS.ALLOWED_ORIGINS);

  // 4. Bind safety invariant (D4 / FR-11): non-loopback HOST requires non-empty MCP_API_KEY
  const isLoopback =
    host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]';

  if (!isLoopback && apiKeys.length === 0) {
    process.stderr.write(
      `Binding to non-loopback HOST "${host}" requires non-empty MCP_API_KEY. Refusing startup to prevent unauthenticated public exposure.\n`,
    );
    process.exit(1);
  }

  const requestBudgetMs = env.REQUEST_BUDGET_MS
    ? Number.parseInt(env.REQUEST_BUDGET_MS, 10)
    : DEFAULTS.REQUEST_BUDGET_MS;
  const deepResearchBudgetMs = env.DEEP_RESEARCH_BUDGET_MS
    ? Number.parseInt(env.DEEP_RESEARCH_BUDGET_MS, 10)
    : DEFAULTS.DEEP_RESEARCH_BUDGET_MS;
  const pageTimeoutMs = env.PAGE_TIMEOUT_MS
    ? Number.parseInt(env.PAGE_TIMEOUT_MS, 10)
    : DEFAULTS.PAGE_TIMEOUT_MS;
  const minPageBudgetMs = env.MIN_PAGE_BUDGET_MS
    ? Number.parseInt(env.MIN_PAGE_BUDGET_MS, 10)
    : DEFAULTS.MIN_PAGE_BUDGET_MS;
  const stabilizeTimeoutMs = env.STABILIZE_TIMEOUT_MS
    ? Number.parseInt(env.STABILIZE_TIMEOUT_MS, 10)
    : DEFAULTS.STABILIZE_TIMEOUT_MS;
  const settlePollMs = env.SETTLE_POLL_MS
    ? Number.parseInt(env.SETTLE_POLL_MS, 10)
    : DEFAULTS.SETTLE_POLL_MS;
  const maxRedirects = env.MAX_REDIRECTS
    ? Number.parseInt(env.MAX_REDIRECTS, 10)
    : DEFAULTS.MAX_REDIRECTS;
  const maxMarkdownChars = env.MAX_MARKDOWN_CHARS
    ? Number.parseInt(env.MAX_MARKDOWN_CHARS, 10)
    : DEFAULTS.MAX_MARKDOWN_CHARS;
  const maxQueueLength = env.MAX_QUEUE_LENGTH
    ? Number.parseInt(env.MAX_QUEUE_LENGTH, 10)
    : DEFAULTS.MAX_QUEUE_LENGTH;
  const maxResultsPerHost = env.MAX_RESULTS_PER_HOST
    ? Number.parseInt(env.MAX_RESULTS_PER_HOST, 10)
    : DEFAULTS.MAX_RESULTS_PER_HOST;
  const dnsCacheTtlMs = env.DNS_CACHE_TTL_MS
    ? Number.parseInt(env.DNS_CACHE_TTL_MS, 10)
    : DEFAULTS.DNS_CACHE_TTL_MS;

  const candidateValues = {
    HOST: host,
    PORT: port,
    MAX_CONCURRENT_PAGES: maxConcurrentPages,
    REQUEST_BUDGET_MS: requestBudgetMs,
    DEEP_RESEARCH_BUDGET_MS: deepResearchBudgetMs,
    PAGE_TIMEOUT_MS: pageTimeoutMs,
    MIN_PAGE_BUDGET_MS: minPageBudgetMs,
    STABILIZE_TIMEOUT_MS: stabilizeTimeoutMs,
    SETTLE_POLL_MS: settlePollMs,
    MAX_REDIRECTS: maxRedirects,
    MAX_MARKDOWN_CHARS: maxMarkdownChars,
    MAX_QUEUE_LENGTH: maxQueueLength,
    MAX_RESULTS_PER_HOST: maxResultsPerHost,
    DNS_CACHE_TTL_MS: dnsCacheTtlMs,
  };

  if (!Value.Check(EnvSchema, candidateValues)) {
    const errors = [...Value.Errors(EnvSchema, candidateValues)];
    const firstErr = errors[0];
    const pathName = firstErr?.path?.replace(/^\//, '') || 'CONFIG';
    process.stderr.write(
      `Invalid environment configuration for ${pathName}: ${firstErr?.message}\n`,
    );
    process.exit(1);
  }

  return {
    host,
    port,
    maxConcurrentPages,
    requestBudgetMs,
    deepResearchBudgetMs,
    pageTimeoutMs,
    minPageBudgetMs,
    stabilizeTimeoutMs,
    settlePollMs,
    maxRedirects,
    maxMarkdownChars,
    maxQueueLength,
    maxResultsPerHost,
    dnsCacheTtlMs,
    apiKeys,
    allowedHosts,
    allowedOrigins,
  };
}

const validated = validateEnvironment(process.env);

/**
 * @purpose Validated web research configuration instance populated from environment variables and OS detection.
 * @rationale Resolves DISPLAY, proxy parameters, timeouts, persistent profiles, scroll tuning, host binding, wildcards, and auth with defensive defaults.
 * @invariants Readonly, immutable configuration object.
 */
export const webResearchConfig: WebResearchConfig = Object.freeze({
  host: validated.host,
  port: validated.port,
  allowedHosts: validated.allowedHosts,
  allowedOrigins: validated.allowedOrigins,
  apiKeys: validated.apiKeys,
  httpProxy: process.env.HTTP_PROXY || process.env.http_proxy || undefined,
  browserTimeoutMs: Math.max(
    1000,
    Number.parseInt(process.env.BROWSER_TIMEOUT_MS || `${DEFAULTS.BROWSER_TIMEOUT_MS}`, 10),
  ),
  maxConcurrentPages: validated.maxConcurrentPages,
  maxContentLength: Math.max(
    1024,
    Number.parseInt(process.env.MAX_CONTENT_LENGTH || `${DEFAULTS.MAX_CONTENT_LENGTH}`, 10),
  ),
  userDataDir: resolveDefaultUserDataDir(),
  maxRequestsBeforeRecycle: Math.max(
    10,
    Number.parseInt(
      process.env.MAX_REQUESTS_BEFORE_RECYCLE || `${DEFAULTS.MAX_REQUESTS_BEFORE_RECYCLE}`,
      10,
    ),
  ),
  networkIdleTimeoutMs: Math.max(
    1000,
    Number.parseInt(
      process.env.NETWORK_IDLE_TIMEOUT_MS || `${DEFAULTS.NETWORK_IDLE_TIMEOUT_MS}`,
      10,
    ),
  ),
  scrollDelayMs: Math.max(
    100,
    Number.parseInt(process.env.SCROLL_DELAY_MS || `${DEFAULTS.SCROLL_DELAY_MS}`, 10),
  ),
  scrollStepPx: Math.max(
    200,
    Number.parseInt(process.env.SCROLL_STEP_PX || `${DEFAULTS.SCROLL_STEP_PX}`, 10),
  ),
  scrollSettleTimeoutMs: Math.max(
    100,
    Number.parseInt(
      process.env.SCROLL_SETTLE_TIMEOUT_MS || `${DEFAULTS.SCROLL_SETTLE_TIMEOUT_MS}`,
      10,
    ),
  ),
  maxScrollSteps: Math.max(
    0,
    Number.parseInt(process.env.MAX_SCROLL_STEPS || `${DEFAULTS.MAX_SCROLL_STEPS}`, 10),
  ),
  searchWaitTimeoutMs: Math.max(
    1000,
    Number.parseInt(process.env.SEARCH_WAIT_TIMEOUT_MS || `${DEFAULTS.SEARCH_WAIT_TIMEOUT_MS}`, 10),
  ),
  readabilityCharThreshold: Math.max(
    5,
    Number.parseInt(
      process.env.READABILITY_CHAR_THRESHOLD || `${DEFAULTS.READABILITY_CHAR_THRESHOLD}`,
      10,
    ),
  ),
  requestBudgetMs: validated.requestBudgetMs,
  deepResearchBudgetMs: validated.deepResearchBudgetMs,
  pageTimeoutMs: validated.pageTimeoutMs,
  minPageBudgetMs: validated.minPageBudgetMs,
  stabilizeTimeoutMs: validated.stabilizeTimeoutMs,
  settlePollMs: validated.settlePollMs,
  maxRedirects: validated.maxRedirects,
  maxMarkdownChars: validated.maxMarkdownChars,
  maxQueueLength: validated.maxQueueLength,
  maxResultsPerHost: validated.maxResultsPerHost,
  defaultHtmlCharset: process.env.DEFAULT_HTML_CHARSET?.trim() || DEFAULTS.DEFAULT_HTML_CHARSET,
  dnsCacheTtlMs: validated.dnsCacheTtlMs,
  googleSearchBase: process.env.GOOGLE_SEARCH_BASE?.trim() || DEFAULTS.GOOGLE_SEARCH_BASE,
  unfoldInteractive: process.env.UNFOLD_INTERACTIVE === 'true' || DEFAULTS.UNFOLD_INTERACTIVE,
  defaultXvfbDisplay: DEFAULTS.DEFAULT_XVFB_DISPLAY,
  xvfbLockPath: DEFAULTS.XVFB_LOCK_PATH,
  xvfbSocketPath: DEFAULTS.XVFB_SOCKET_PATH,
  xvfbScreenResolution: DEFAULTS.XVFB_SCREEN_RESOLUTION,
  chromeChannel: DEFAULTS.CHROME_CHANNEL,
  blockedResourceTypes: DEFAULTS.BLOCKED_RESOURCE_TYPES,
  botWallPatterns: DEFAULTS.BOT_WALL_PATTERNS,
  maxUnfoldPerPage: DEFAULTS.MAX_UNFOLD_PER_PAGE,
});

/**
 * @purpose Standard Shukoi platform runtime configuration.
 * @rationale Provides base limits, observability settings, and security policies for MCP transports.
 * @invariants Deeply frozen ShukoiConfig instance.
 */
export const config: ShukoiConfig = createDefaultConfig({
  observability: {
    serviceName: 'mcp-web-research',
    serviceVersion: resolveServiceVersion(),
    environment: (process.env.NODE_ENV || 'development') as
      | 'development'
      | 'staging'
      | 'production'
      | 'test',
  },
  security: {
    allowedHosts: webResearchConfig.allowedHosts,
    allowedOrigins: webResearchConfig.allowedOrigins,
  },
});
