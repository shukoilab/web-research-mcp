/**
 * @purpose Multi-source Deep Web Research service orchestrating Google Search and sequential webpage extraction.
 * @rationale Synthesizes search query discovery with bulk full-page article extraction, anti-bot evasion, SSRF protection, and token-efficient Markdown budgeting.
 * @preconditions Chrome binary and Xvfb display :99 must be active.
 * @invariants Pure Web-Standard service; zero node:* imports; sequential execution; invariant totalReturned + excludedCount === totalFound.
 */

import { DomainError } from '@shukoi/core';
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
 * @rationale Dispatches INTERNAL_HOST and PRIVATE_IP to 'ssrf_blocked', and EMPTY, MALFORMED, and PROTOCOL to 'invalid_url' with compile-time exhaustiveness.
 * @preconditions kind is a valid UrlRejectionKind.
 * @param kind Rejection category from checkPublicUrl.
 * @returns Short coded reason string ('ssrf_blocked' or 'invalid_url').
 * @throws Never throws directly; compile error if any kind is missing.
 * @invariants Pure mapping; Big-O time complexity O(1).
 */
function mapRejection(kind: UrlRejectionKind): string {
  switch (kind) {
    case 'INTERNAL_HOST':
    case 'PRIVATE_IP':
      return 'ssrf_blocked';
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
 * @rationale Provides clean Markdown and article title alongside canonical destination URL and truncation status.
 * @invariants Readonly data structure.
 */
export interface DeepResearchResultItem {
  readonly title: string;
  readonly url: string;
  readonly markdown: string;
  readonly truncated: boolean;
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
 * @rationale Executes Google Search for query discovery, enforces SSRF defenses, sequentially navigates and extracts top-N canonical URLs to clean GFM Markdown, and enforces strict token budgets with deterministic error discarding.
 * @preconditions Query must be non-empty; browser pool must be operational.
 * @param params Deep research configuration parameters (query, limit, language, country, safeSearch, ultraFast, smartScroll, scrollDelayMs, maxScrolls, timeoutMs, maxCharsPerResult, maxTotalChars).
 * @param signal Optional AbortSignal for cooperative cancellation.
 * @param _logger Optional structured logger instance.
 * @returns Promise resolving to DeepResearchResult containing query, totals, excluded count, errors, and results.
 * @throws DomainError BAD_REQUEST on invalid query or cancellation, DomainError on search infrastructure failure.
 * @invariants Sequential execution (no Promise.all); invariant totalReturned + excludedCount === totalFound; sum of markdown lengths <= maxTotalChars.
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

  // 3. Establish parameters with deterministic defaults (favoring bulk speed)
  const limit = Math.min(10, Math.max(1, params.limit ?? 5));
  const language = params.language?.trim() || 'en';
  const country = params.country?.trim() || 'us';
  const safeSearch = params.safeSearch !== false;
  const ultraFast = params.ultraFast !== false;
  const smartScroll = params.smartScroll !== false;
  const scrollDelayMs = params.scrollDelayMs ?? 500;
  const maxScrolls = params.maxScrolls ?? 6;
  const timeoutMs = params.timeoutMs ?? 30000;
  const maxCharsPerResult = params.maxCharsPerResult ?? 20000;
  const maxTotalChars = params.maxTotalChars ?? 100000;

  // 4. Execute Search Phase
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

  // 5. Sequential Extraction Phase with Token Budgeting and Discard Tracking
  const results: DeepResearchResultItem[] = [];
  const errors: DeepResearchErrorItem[] = [];
  let excludedCount = 0;
  let remainingBudget = maxTotalChars;

  for (let i = 0; i < searchResponse.results.length; i++) {
    const item = searchResponse.results[i];
    if (!item) {
      continue;
    }

    // Check cancellation prior to each page extraction
    if (signal?.aborted) {
      throw new DomainError('BAD_REQUEST', 'Operation cancelled by caller');
    }

    // Check if character budget is exhausted before visiting next URL
    if (remainingBudget <= 0) {
      for (let j = i; j < searchResponse.results.length; j++) {
        const unvisited = searchResponse.results[j];
        if (unvisited) {
          errors.push({
            url: unvisited.url,
            reason: 'budget_exceeded',
          });
          excludedCount++;
        }
      }
      break;
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

    try {
      const extracted = await extractSingleUrlContent(check.url, {
        signal,
        timeoutMs,
        smartScroll,
        scrollDelayMs,
        maxScrolls,
        ultraFast,
      });

      // Discard empty or whitespace-only markdown unless anti-bot fallback produced content
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
        remainingBudget,
      );
      remainingBudget -= text.length;

      results.push({
        title: extracted.title,
        url: item.url,
        markdown: text,
        truncated,
      });
    } catch (err: unknown) {
      // Propagate abort errors immediately
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
      let reason = 'unknown_error';
      if (err instanceof DomainError) {
        const msg = err.message.toLowerCase();
        if (err.code === 'GATEWAY_TIMEOUT' || msg.includes('timeout')) {
          reason = 'timeout';
        } else {
          reason = `error:${err.code.toLowerCase()}`;
        }
      } else if (err instanceof Error) {
        if (err.message.toLowerCase().includes('timeout')) {
          reason = 'timeout';
        } else {
          reason = 'error:extraction_failed';
        }
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
