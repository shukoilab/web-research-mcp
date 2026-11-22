/**
 * @purpose Google Search automation, SERP card parsing, and hygiene filtering service using stealth Patchright browser.
 * @rationale Performs search queries on Google with automatic consent dialog bypass, udm=14 web-only targeting, canonical link hygiene, and bot-wall/captcha detection without synthetic path fabrication.
 * @preconditions Chrome binary and Xvfb display must be available.
 * @invariants Pure stealth query execution; results deduplicated by host+path+query; zero memory leak; zero fabricated paths.
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
 * @rationale Provides both canonical destination URL and full redirect URL alongside snippet context.
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
 * @purpose Computes a deduplication key based on normalized host, path, and search query.
 * @rationale Ignores fragment hashes and trailing slashes so duplicate cards pointing to the same document are deduped.
 * @preconditions urlStr is a non-empty string.
 * @param urlStr Raw URL string.
 * @returns Normalized deduplication key string.
 * @throws Never throws directly.
 * @invariants Pure string normalization; Big-O time complexity O(1).
 */
export function getDedupeKey(urlStr: string): string {
  try {
    const u = new URL(urlStr);
    const pathname = u.pathname.replace(/\/+$/, '') || '/';
    return `${u.host.toLowerCase()}${pathname}${u.search}`;
  } catch {
    return urlStr.toLowerCase();
  }
}

/**
 * @purpose Determines if a candidate URL should be dropped due to Google internal tracking or undecodable protobuf redirects.
 * @rationale Drops opaque Google goto tracking protobuf blobs and invalid url links that cannot be resolved safely.
 * @preconditions urlStr is a string.
 * @param urlStr Candidate URL string to inspect.
 * @returns True if URL is an undecodable Google tracking link, false otherwise.
 * @throws Never throws.
 * @invariants O(1) hostname and pathname check.
 */
export function isGoogleTrackingUrl(urlStr: string): boolean {
  try {
    const u = new URL(urlStr);
    const host = u.hostname.toLowerCase();
    const isGoogleHost =
      host === 'google.com' || host.endsWith('.google.com') || host.includes('.google.');
    if (!isGoogleHost) return false;

    if (u.pathname === '/goto' || u.pathname.startsWith('/goto/')) {
      return true;
    }
    if (u.pathname === '/url' || u.pathname.startsWith('/url/')) {
      // If /url has a clean q= or url= parameter targeting external http/https, it may be extracted; otherwise drop
      const target = u.searchParams.get('q') || u.searchParams.get('url');
      if (!target?.startsWith('http')) {
        return true;
      }
    }
  } catch {}
  return false;
}

/**
 * @purpose Normalizes a raw Google breadcrumb cite string and anchor href into a canonical HTTP/HTTPS destination URL.
 * @rationale Resolves direct destination links, extracts redirected query parameters, and drops truncated breadcrumbs containing ellipsis markers without fabricating artificial URL paths.
 * @preconditions citeText and fallbackHref are string or null.
 * @param citeText Raw text from Google cite element.
 * @param fallbackHref Fallback href attribute value from anchor element.
 * @returns Clean canonical URL string, or empty string if URL is invalid or undecodable.
 * @throws Never throws directly.
 * @invariants O(1) string transformation; zero fabricated path segments.
 */
export function normalizeCanonicalUrl(
  citeText?: string | null,
  fallbackHref?: string | null,
): string {
  // 1. If fallbackHref is a direct non-Google external HTTP/HTTPS URL, it is authoritative
  if (fallbackHref?.startsWith('http')) {
    if (!isGoogleTrackingUrl(fallbackHref)) {
      return fallbackHref;
    }
    // Attempt extracting destination from Google /url?q= parameter
    try {
      const u = new URL(fallbackHref);
      const q = u.searchParams.get('q') || u.searchParams.get('url');
      if (q?.startsWith('http') && !isGoogleTrackingUrl(q)) {
        return q;
      }
    } catch {}
  }

  // 2. Inspect citeText for canonical URL if fallbackHref was missing or internal
  if (citeText?.trim().startsWith('http')) {
    const cleanCite = citeText.trim();

    // FR-07: Never synthesize paths if breadcrumbs contain truncation markers
    if (cleanCite.includes('…') || cleanCite.includes('...')) {
      // If the base host before the first separator is valid, return just the base URL, never synthesize truncated path
      const parts = cleanCite.split(/[›>]/).map((p) => p.trim());
      const base = parts[0];
      if (base?.startsWith('http') && !base.includes('…') && !base.includes('...')) {
        try {
          return new URL(base).href;
        } catch {}
      }
      return '';
    }

    const parts = cleanCite
      .split(/[›>]/)
      .map((p) => p.trim())
      .filter((p) => p.length > 0 && p !== '...' && p !== '…');

    if (parts.length > 0) {
      const base = parts[0];
      if (parts.length === 1) {
        return base;
      }
      const pathSegments = parts.slice(1).join('/');
      return base.endsWith('/') ? `${base}${pathSegments}` : `${base}/${pathSegments}`;
    }
  }

  return '';
}

/**
 * @purpose Executes Google search query using stealth browser context and parses organic results with web-only udm=14 view.
 * @rationale Automates stealth navigation under DISPLAY=:99, auto-dismisses consent gates, extracts cards, drops tracking links, and resolves canonical URLs without hallucination.
 * @preconditions params.query must be a non-empty string.
 * @param params Search query parameters (query, limit, language, country, safeSearch).
 * @param signal Optional AbortSignal to cancel in-flight search execution.
 * @returns Promise resolving to GoogleSearchResult with structured items.
 * @throws DomainError BAD_REQUEST on invalid query or abort, GATEWAY_TIMEOUT on timeout, RATE_LIMIT_EXCEEDED on CAPTCHA, SERVICE_UNAVAILABLE on browser failure.
 * @invariants Semaphore bounded concurrency; deduplicated results; maximum limit 10.
 */
export async function executeGoogleSearch(
  params: GoogleSearchParams,
  signal?: AbortSignal,
): Promise<GoogleSearchResult> {
  const query = params.query?.trim();
  if (!query) {
    throw new DomainError('BAD_REQUEST', 'Search query cannot be empty');
  }

  // D3: Google Search limit capped at 10
  const limit = Math.min(10, Math.max(1, params.limit ?? 10));
  const language = params.language?.trim() || 'en';
  const country = params.country?.trim() || 'us';
  const safeSearch = params.safeSearch !== false ? 'active' : 'off';

  // Add udm=14 for pure web results view without AI overview clutter
  const searchBase = webResearchConfig.googleSearchBase;
  const searchUrl = `${searchBase}?q=${encodeURIComponent(query)}&hl=${encodeURIComponent(language)}&gl=${encodeURIComponent(country)}&safe=${safeSearch}&udm=14`;

  const browserManager = BrowserManager.getInstance();

  return await browserManager.withPage(
    async (page) => {
      // 1. Navigate to Google Search
      await page.goto(searchUrl, { waitUntil: 'domcontentloaded' });

      // 2. Detect CAPTCHA or unusual traffic wall
      const pageText = await page.evaluate(() => document.body?.textContent || '').catch(() => '');
      if (
        pageText.includes('unusual traffic from your computer network') ||
        pageText.includes('our systems have detected unusual traffic') ||
        pageText.includes('solve this CAPTCHA')
      ) {
        throw new DomainError(
          'RATE_LIMIT_EXCEEDED',
          'Google Search CAPTCHA or bot verification detected. Please try again later or configure an HTTP proxy.',
        );
      }

      // 3. Bypass Consent Dialog if presented
      const consentButton = await page.$(
        'button:has-text("Accept all"), button:has-text("I agree"), form[action*="consent"] button',
      );
      if (consentButton) {
        await consentButton.click().catch(() => {});
        await page.waitForLoadState('domcontentloaded').catch(() => {});
      }

      // 4. Await search card container elements
      await page
        .waitForSelector('div.N54PNb, div.g, div.MjjYud, h3', {
          timeout: webResearchConfig.searchWaitTimeoutMs,
        })
        .catch(() => {});

      // 5. Extract structured cards in browser execution context
      const rawCards = await page.evaluate(() => {
        const items: Array<{
          title: string;
          rawHref: string | null;
          citeText: string | null;
          snippet: string;
        }> = [];

        // Select search result cards or links containing h3
        const cardElements = document.querySelectorAll(
          'div.N54PNb, div.g, div.MjjYud, div[data-hveid]',
        );

        for (const card of cardElements) {
          const h3 = card.querySelector('h3');
          const a = card.querySelector('a:has(h3)') || card.querySelector('a');
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

      // 6. Post-process, canonicalize, hygiene filter, and deduplicate items
      const results: SearchResultItem[] = [];
      const seenDedupeKeys = new Set<string>();

      for (const raw of rawCards) {
        // Drop items with truncation markers in title
        if (raw.title.includes('…') || raw.title.includes('...')) {
          continue;
        }

        const canonicalUrl = normalizeCanonicalUrl(raw.citeText, raw.rawHref);
        if (!canonicalUrl || isGoogleTrackingUrl(canonicalUrl)) {
          continue;
        }

        const dedupeKey = getDedupeKey(canonicalUrl);
        if (seenDedupeKeys.has(dedupeKey)) {
          continue;
        }
        seenDedupeKeys.add(dedupeKey);

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
