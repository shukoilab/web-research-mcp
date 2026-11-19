/**
 * @purpose Google Search automation and SERP parsing service using stealth Patchright browser.
 * @rationale Performs search queries on Google with automatic consent dialog bypass, canonical link extraction from breadcrumbs, and rich snippet parsing.
 * @preconditions Chrome binary and Xvfb display must be available.
 * @invariants Pure stealth query execution; results deduplicated; zero memory leak.
 */

import { DomainError } from '@shukoi/core';
import { webResearchConfig } from '../config.js';
import { BrowserManager } from './browser.js';

/**
 * @purpose Search query execution input parameters.
 * @rationale Defines query terms, pagination bounds, language/region targeting, and safe search filtering.
 * @invariants Readonly configuration object.
 */
export interface GoogleSearchParams {
  readonly query: string;
  readonly limit?: number;
  readonly language?: string;
  readonly country?: string;
  readonly safeSearch?: boolean;
}

/**
 * @purpose Structured representation of an individual Google search result card.
 * @rationale Provides both canonical destination URL and full Google redirect URL alongside snippet context.
 * @invariants Readonly data structure.
 */
export interface SearchResultItem {
  readonly title: string;
  readonly url: string;
  readonly redirectUrl: string;
  readonly snippet: string;
}

/**
 * @purpose Composite response object returned by Google search execution.
 * @rationale Delivers structured array of items with query metadata and verification counts.
 * @invariants Immutable data payload.
 */
export interface GoogleSearchResult {
  readonly query: string;
  readonly totalReturned: number;
  readonly results: SearchResultItem[];
  readonly timestamp: string;
}

/**
 * @purpose Normalizes a raw Google breadcrumb cite string into a canonical HTTP/HTTPS URL.
 * @rationale Google often renders breadcrumbs like "https://example.com › docs › api" in <cite> tags rather than direct links in the href attribute.
 * @preconditions citeText is a raw string from <cite> element or fallback link.
 * @param citeText Raw text from Google cite element.
 * @param fallbackHref Fallback href attribute value from anchor element.
 * @returns Clean canonical URL string.
 * @throws Never throws directly.
 * @invariants O(1) string transformation.
 */
export function normalizeCanonicalUrl(
  citeText?: string | null,
  fallbackHref?: string | null,
): string {
  if (citeText?.trim().startsWith('http')) {
    // Replace Google breadcrumb separators (› or >) with /
    const parts = citeText
      .split(/[›>]/)
      .map((p) => p.trim())
      .filter((p) => p.length > 0);

    if (parts.length > 0) {
      const base = parts[0];
      if (parts.length === 1) {
        return base;
      }
      const path = parts.slice(1).join('/');
      return base.endsWith('/') ? `${base}${path}` : `${base}/${path}`;
    }
  }

  if (fallbackHref) {
    if (fallbackHref.startsWith('http')) {
      return fallbackHref;
    }
    if (fallbackHref.startsWith('/')) {
      return `https://www.google.com${fallbackHref}`;
    }
  }

  return '';
}

/**
 * @purpose Executes Google search query using stealth browser context and parses organic results.
 * @rationale Automates stealth navigation under DISPLAY=:99, auto-dismisses consent gates, extracts cards, and resolves canonical URLs.
 * @preconditions params.query must be a non-empty string.
 * @param params Search query parameters (query, limit, language, country, safeSearch).
 * @param signal Optional AbortSignal to cancel in-flight search execution.
 * @returns Promise resolving to GoogleSearchResult with structured items.
 * @throws DomainError BAD_REQUEST on invalid query or abort, GATEWAY_TIMEOUT on timeout, SERVICE_UNAVAILABLE on browser failure.
 * @invariants Semaphore bounded concurrency; zero zombie Chrome instances; deduplicated results.
 */
export async function executeGoogleSearch(
  params: GoogleSearchParams,
  signal?: AbortSignal,
): Promise<GoogleSearchResult> {
  const query = params.query?.trim();
  if (!query) {
    throw new DomainError('BAD_REQUEST', 'Search query cannot be empty');
  }

  const limit = Math.min(50, Math.max(1, params.limit ?? 10));
  const language = params.language?.trim() || 'en';
  const country = params.country?.trim() || 'us';
  const safeSearch = params.safeSearch !== false ? 'active' : 'off';

  const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&hl=${encodeURIComponent(language)}&gl=${encodeURIComponent(country)}&safe=${safeSearch}`;

  const browserManager = BrowserManager.getInstance();

  return await browserManager.withPage(
    async (page) => {
      // 1. Navigate to Google Search
      await page.goto(searchUrl, { waitUntil: 'domcontentloaded' });

      // 2. Bypass Consent Dialog if presented
      const consentButton = await page.$(
        'button:has-text("Accept all"), button:has-text("I agree"), form[action*="consent"] button',
      );
      if (consentButton) {
        await consentButton.click().catch(() => {});
        await page.waitForLoadState('domcontentloaded').catch(() => {});
      }

      // 3. Await search card container elements
      await page
        .waitForSelector('div.N54PNb, div.g, div.MjjYud, h3', {
          timeout: webResearchConfig.searchWaitTimeoutMs,
        })
        .catch(() => {});

      // 4. Extract structured cards in browser execution context
      const rawCards = await page.evaluate(() => {
        const items: Array<{
          title: string;
          rawHref: string | null;
          citeText: string | null;
          snippet: string;
        }> = [];

        const cardElements = document.querySelectorAll('div.N54PNb, div.g, div.MjjYud');

        for (const card of cardElements) {
          const h3 = card.querySelector('h3');
          const a = card.querySelector('a');
          const cite = card.querySelector('cite');
          const snippetEl = card.querySelector(
            'div[style*="-webkit-line-clamp"], div.VwiC3b, span.aCOpRe',
          );

          if (h3?.textContent?.trim() && a) {
            const rawHref = a.getAttribute('href');
            items.push({
              title: h3.textContent.trim(),
              rawHref,
              citeText: cite?.textContent?.trim() || null,
              snippet: snippetEl?.textContent?.trim() || '',
            });
          }
        }

        return items;
      });

      // 5. Post-process, canonicalize, and deduplicate items
      const results: SearchResultItem[] = [];
      const seenUrls = new Set<string>();

      for (const raw of rawCards) {
        const canonicalUrl = normalizeCanonicalUrl(raw.citeText, raw.rawHref);
        if (!canonicalUrl || seenUrls.has(canonicalUrl)) {
          continue;
        }

        seenUrls.add(canonicalUrl);

        let redirectUrl = raw.rawHref || canonicalUrl;
        if (redirectUrl.startsWith('/')) {
          redirectUrl = `https://www.google.com${redirectUrl}`;
        }

        results.push({
          title: raw.title,
          url: canonicalUrl,
          redirectUrl,
          snippet: raw.snippet,
        });

        if (results.length >= limit) {
          break;
        }
      }

      return {
        query,
        totalReturned: results.length,
        results,
        timestamp: new Date().toISOString(),
      };
    },
    { signal },
  );
}
