/**
 * @purpose Multi-source Deep Web Research service orchestrating Google Search and sequential webpage extraction.
 * @rationale Synthesizes search query discovery with bulk full-page article extraction, anti-bot evasion, SSRF protection, deadline budget management, and token-efficient Markdown budgeting.
 * @preconditions Chrome binary and Xvfb display :99 must be active.
 * @invariants Pure Web-Standard service; zero node:* imports; sequential execution; invariant totalReturned + excludedCount === totalFound.
 */

import { DomainError } from '@shukoi/core';
import { webResearchConfig } from '../config.js';
import { Deadline } from './deadline.js';
import { extractSingleUrlContent } from './extractor.js';
import { executeGoogleSearch } from './search.js';
import { checkPublicUrl, type UrlRejectionKind } from './ssrf.js';

/**
 * @purpose Exhaustive check helper ensuring all union arms are handled at compile time.
 * @rationale Causes a TypeScript compilation failure if a new UrlRejectionKind variant is added without updating callers.
 * @preconditions Must only be invoked in default branch of exhaustive switch statements.
 * @param x Value of type never resulting from exhaustive checks.
 * @returns Never returns normally.
 * @throws Error stating unexpected rejection kind.
 * @invariants Big-O time complexity O(1); compile-time exhaustiveness guard.
 */
function assertNever(x: never): never {
  throw new Error(`Unexpected UrlRejectionKind: ${String(x)}`);
}

/**
 * @purpose Maps a typed SSRF/URL rejection kind to an externally visible error reason code.
 * @rationale Dispatches INTERNAL_HOST and PRIVATE_IP to 'ssrf_blocked', DNS_FAILURE to 'dns_failure', and EMPTY, MALFORMED, PROTOCOL to 'invalid_url'.
 * @preconditions kind is a valid UrlRejectionKind.
 * @param kind Rejection category from checkPublicUrl.
 * @returns Short coded reason string ('ssrf_blocked', 'dns_failure', or 'invalid_url').
 * @throws Never throws directly; compile error if any kind is missing.
 * @invariants Pure mapping; Big-O time complexity O(1).
 */
function mapRejection(kind: UrlRejectionKind): string {
  switch (kind) {
    case 'INTERNAL_HOST':
    case 'PRIVATE_IP':
      return 'ssrf_blocked';
    case 'DNS_FAILURE':
      return 'dns_failure';
    case 'EMPTY':
    case 'MALFORMED':
    case 'PROTOCOL':
      return 'invalid_url';
    default:
      return assertNever(kind);
  }
}

/**
 * @purpose Parameter interface for deep research execution.
 * @rationale Exposes query options, pagination limit, language/country localization, resource blocking flags, and strict character budget thresholds.
 * @invariants Readonly configuration structure.
 */
export interface DeepResearchParams {
  readonly query: string;
  readonly limit?: number;
  readonly language?: string;
  readonly country?: string;
  readonly safeSearch?: boolean;
  readonly ultraFast?: boolean;
  readonly smartScroll?: boolean;
  readonly scrollDelayMs?: number;
  readonly maxScrolls?: number;
  readonly timeoutMs?: number;
  readonly maxCharsPerResult?: number;
  readonly maxTotalChars?: number;
}

/**
 * @purpose Error item descriptor for an excluded search result.
 * @rationale Captures target URL and diagnostic reason code without leaking sensitive payloads or stack traces.
 * @invariants Readonly error item record.
 */
export interface DeepResearchErrorItem {
  readonly url: string;
  readonly reason: string;
}

/**
 * @purpose Extracted article item returned from deep research.
 * @rationale Provides clean Markdown, title, destination URL, truncation status, HTTP status, and redirect count.
 * @invariants Readonly data structure.
 */
export interface DeepResearchResultItem {
  readonly title: string;
  readonly url: string;
  readonly markdown: string;
  readonly truncated: boolean;
  readonly status: number | null;
  readonly redirectCount: number;
}

/**
 * @purpose Composite result payload of deep research execution.
 * @rationale Bundles search metadata, total counts, successful articles, and excluded error records for LLM consumption.
 * @invariants Invariant totalReturned + excludedCount === totalFound; sum of markdown lengths <= maxTotalChars.
 */
export interface DeepResearchResult {
  readonly query: string;
  readonly totalFound: number;
  readonly totalReturned: number;
  readonly excludedCount: number;
  readonly errors: DeepResearchErrorItem[];
  readonly results: DeepResearchResultItem[];
  readonly timestamp: string;
}

/**
 * @purpose Budgeting and character truncation helper for Markdown content.
 * @rationale Caps individual article lengths and enforces the total character budget across all extracted articles without throwing exceptions.
 * @preconditions markdown is a string; perResultCap and remainingTotal are non-negative numbers.
 * @param markdown Extracted Markdown content to budget.
 * @param perResultCap Maximum character length permitted for an individual result.
 * @param remainingTotal Remaining character budget across the entire research batch.
 * @returns Object with text containing the budgeted Markdown string and truncated boolean flag.
 * @throws Never throws.
 * @invariants Pure string manipulation; O(1) time complexity; len(text) <= min(len(markdown), perResultCap, max(0, remainingTotal)).
 */
export function applyBudget(
  markdown: string,
  perResultCap: number,
  remainingTotal: number,
): { text: string; truncated: boolean } {
  const effectiveCap = Math.max(0, Math.min(perResultCap, remainingTotal));
  const text = markdown.slice(0, effectiveCap);
  const truncated = markdown.length > text.length;
  return { text, truncated };
}

/**
 * @purpose Orchestrates multi-source deep web research combining Google Search and sequential full-page extraction.
 * @rationale Executes Google Search for query discovery, enforces SSRF defenses, sequentially navigates and extracts top-N canonical URLs to clean GFM Markdown, and enforces strict token and time budgets with deterministic error discarding.
 * @preconditions Query must be non-empty; browser pool must be operational.
 * @param params Deep research configuration parameters.
 * @param signal Optional AbortSignal for cooperative cancellation.
 * @param _logger Optional structured logger instance.
 * @returns Promise resolving to DeepResearchResult containing query, totals, excluded count, errors, and results.
 * @throws DomainError BAD_REQUEST on invalid query or cancellation, DomainError on search infrastructure failure.
 * @invariants Sequential execution; invariant totalReturned + excludedCount === totalFound; sum of markdown lengths <= maxTotalChars.
 */
export async function executeDeepResearch(
  params: DeepResearchParams,
  signal?: AbortSignal,
  _logger?: {
    info?: (msg: string, meta?: Record<string, unknown>) => void;
    error?: (msg: string, meta?: Record<string, unknown>) => void;
  },
): Promise<DeepResearchResult> {
  // 1. Cooperative cancellation pre-check
  if (signal?.aborted) {
    throw new DomainError('BAD_REQUEST', 'Operation cancelled by caller');
  }

  // 2. Validate research query
  const query = params.query?.trim();
  if (!query) {
    throw new DomainError('BAD_REQUEST', 'Search query cannot be empty');
  }

  // 3. Establish parameters with deterministic defaults
  const limit = Math.min(10, Math.max(1, params.limit ?? 5));
  const language = params.language?.trim() || 'en';
  const country = params.country?.trim() || 'us';
  const safeSearch = params.safeSearch !== false;
  const ultraFast = params.ultraFast !== false;
  const smartScroll = params.smartScroll !== false;
  const scrollDelayMs = params.scrollDelayMs ?? webResearchConfig.scrollDelayMs;
  const maxScrolls = params.maxScrolls ?? webResearchConfig.maxScrollSteps;
  const maxCharsPerResult = params.maxCharsPerResult ?? 20000;
  const maxTotalChars = params.maxTotalChars ?? webResearchConfig.maxMarkdownChars;

  // 4. Global deadline initialization (FR-06, FR-08)
  const configuredBudget = params.timeoutMs ?? webResearchConfig.deepResearchBudgetMs;
  const globalDeadline = Deadline.create(configuredBudget, signal);
  const minPageBudgetMs = webResearchConfig.minPageBudgetMs;
  const pageTimeoutMs = Math.min(
    webResearchConfig.pageTimeoutMs,
    globalDeadline.slice(webResearchConfig.pageTimeoutMs),
  );

  // 5. Execute Search Phase
  globalDeadline.throwIfExpired();
  const searchResponse = await executeGoogleSearch(
    {
      query,
      limit,
      language,
      country,
      safeSearch,
    },
    signal,
  );

  const totalFound = searchResponse.results.length;
  if (totalFound === 0) {
    return {
      query,
      totalFound: 0,
      totalReturned: 0,
      excludedCount: 0,
      errors: [],
      results: [],
      timestamp: new Date().toISOString(),
    };
  }

  // 6. Sequential Extraction Phase with Token Budgeting and Discard Tracking
  const results: DeepResearchResultItem[] = [];
  const errors: DeepResearchErrorItem[] = [];
  let excludedCount = 0;
  let remainingCharBudget = maxTotalChars;
  const hostVisitCounts = new Map<string, number>();
  const maxResultsPerHost = webResearchConfig.maxResultsPerHost;

  for (let i = 0; i < searchResponse.results.length; i++) {
    const item = searchResponse.results[i];
    if (!item) {
      continue;
    }

    // Check cancellation prior to each page extraction
    if (signal?.aborted) {
      throw new DomainError('BAD_REQUEST', 'Operation cancelled by caller');
    }

    // Check time or character budget exhaustion before visiting next URL (FR-08)
    if (globalDeadline.remaining < minPageBudgetMs || remainingCharBudget <= 0) {
      for (let j = i; j < searchResponse.results.length; j++) {
        const unvisited = searchResponse.results[j];
        if (unvisited) {
          errors.push({
            url: unvisited.url,
            reason: 'budget_exhausted',
          });
          excludedCount++;
        }
      }
      break;
    }

    // Per-host extraction cap enforcement
    let itemHost = '';
    try {
      itemHost = new URL(item.url).hostname.toLowerCase();
    } catch {}

    if (itemHost) {
      const currentHostVisits = hostVisitCounts.get(itemHost) || 0;
      if (currentHostVisits >= maxResultsPerHost) {
        errors.push({
          url: item.url,
          reason: 'blocked',
        });
        excludedCount++;
        continue;
      }
      hostVisitCounts.set(itemHost, currentHostVisits + 1);
    }

    // Pre-extraction SSRF and URL validation via pure classifier
    const check = checkPublicUrl(item.url);
    if (!check.ok) {
      errors.push({
        url: item.url,
        reason: mapRejection(check.reason),
      });
      excludedCount++;
      continue;
    }

    const perPageTimeout = Math.min(pageTimeoutMs, globalDeadline.remaining);

    try {
      const extracted = await extractSingleUrlContent(check.url, {
        signal,
        timeoutMs: perPageTimeout,
        smartScroll,
        scrollDelayMs,
        maxScrolls,
        ultraFast,
      });

      // Discard empty or whitespace-only markdown
      const trimmedMd = extracted.markdown?.trim() ?? '';
      if (!trimmedMd) {
        errors.push({
          url: item.url,
          reason: 'empty_content',
        });
        excludedCount++;
        continue;
      }

      // Enforce per-result and global remaining character budgets
      const { text, truncated } = applyBudget(
        extracted.markdown,
        maxCharsPerResult,
        remainingCharBudget,
      );
      remainingCharBudget -= text.length;

      results.push({
        title: extracted.title,
        url: item.url,
        markdown: text,
        truncated,
        status: extracted.status,
        redirectCount: extracted.redirectCount,
      });
    } catch (err: unknown) {
      // Propagate client abort errors immediately
      if (
        signal?.aborted ||
        (err instanceof DomainError &&
          err.code === 'BAD_REQUEST' &&
          err.message.toLowerCase().includes('abort'))
      ) {
        throw err instanceof DomainError
          ? err
          : new DomainError('BAD_REQUEST', 'Operation cancelled by caller');
      }

      // Deterministic error categorization into short coded strings
      let reason = 'error';
      const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();

      if (msg.includes('ssrf') || msg.includes('private or reserved') || msg.includes('internal')) {
        reason = 'ssrf_blocked';
      } else if (msg.includes('dns')) {
        reason = 'dns_failure';
      } else if (msg.includes('redirect')) {
        reason = 'redirect_loop';
      } else if (msg.includes('unsupported')) {
        reason = 'unsupported_content';
      } else if (msg.includes('empty')) {
        reason = 'empty_content';
      } else if (msg.includes('navigating')) {
        reason = 'navigating';
      } else if (
        msg.includes('timeout') ||
        (err instanceof DomainError && err.code === 'GATEWAY_TIMEOUT')
      ) {
        reason = 'timeout';
      } else if (msg.includes('block') || msg.includes('wall')) {
        reason = 'blocked';
      } else if (err instanceof DomainError) {
        reason = `http_status_${err.code.toLowerCase()}`;
      }

      errors.push({
        url: item.url,
        reason,
      });
      excludedCount++;
    }
  }

  return {
    query,
    totalFound,
    totalReturned: results.length,
    excludedCount,
    errors,
    results,
    timestamp: new Date().toISOString(),
  };
}
