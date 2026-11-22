/**
 * @purpose Resilient webpage navigation, request-level SSRF interception, document settling, and content capture pipeline.
 * @rationale Guarantees zero SSRF leakage across redirects and subresources, handles SPA/meta/JS redirects with deterministic settling, repairs omitted charsets, and classifies non-2xx/PDF/204 responses into typed outcomes.
 * @preconditions Active Patchright Page instance; network connectivity to public targets.
 * @invariants Page-scoped request routing; request-level DNS verification; non-throwing classification of domain outcomes; thread-safe.
 */

import { DomainError } from '@shukoi/core';
import type { Page, Response, Route } from 'patchright';
import { webResearchConfig } from '../config.js';
import { assertPublicUrl, checkPublicUrl } from './ssrf.js';

/**
 * @purpose Closed union of categorized navigation outcome classifications.
 * @rationale Replaces unstructured exception throwing with compiler-enforced discriminated handling of network, content, and security results.
 * @invariants Immutable string literal union.
 */
export type NavOutcome =
  | 'success'
  | 'ssrf'
  | 'redirect_loop'
  | 'unsupported_content'
  | 'empty_content'
  | 'timeout'
  | 'blocked'
  | 'error';

/**
 * @purpose Structured telemetry and content payload returned by navigateAndCapture.
 * @rationale Encapsulates HTTP status, final landed URL, redirect hop count, raw HTML, and metadata without throwing for standard web conditions.
 * @invariants Readonly composite data contract.
 */
export interface NavResult {
  readonly status: number | null;
  readonly contentType: string | null;
  readonly finalUrl: string;
  readonly redirectCount: number;
  readonly html: string;
  readonly title: string;
  readonly description: string | null;
  readonly htmlTruncated: boolean;
  readonly outcome: NavOutcome;
  readonly reason?: string;
}

/**
 * @purpose Resolves the landed URL, replacing Chrome's synthetic error-page URL with the real response URL.
 * @rationale Error statuses with an empty body make Chromium render an internal error page whose URL is "chrome-error://chromewebdata/", which is unusable as a caller-facing final URL.
 * @preconditions page is an active Patchright Page; requestedUrl is the original absolute URL.
 * @param page Active page whose current URL is read.
 * @param lastResponse Last observed main-frame response, or null when none was recorded.
 * @param requestedUrl Original request URL used as the ultimate fallback.
 * @returns Absolute HTTP(S) URL the document actually landed on.
 * @throws Never throws.
 * @invariants Pure read; Big-O time complexity O(1).
 */
function resolveLandedUrl(page: Page, lastResponse: Response | null, requestedUrl: string): string {
  const current = page.url();
  if (current.startsWith('chrome-error://')) {
    return lastResponse?.url() || requestedUrl;
  }
  return current || requestedUrl;
}

/**
 * @purpose Configuration options parameterizing page navigation and request guarding.
 * @rationale Slices timeouts, controls heavy resource blocking, specifies settling poll intervals, and permits loopback for testing fixtures.
 * @invariants Readonly options object.
 */
export interface NavigateOptions {
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  readonly ultraFast?: boolean;
  readonly maxRedirects?: number;
  readonly settlePollMs?: number;
  readonly stabilizeTimeoutMs?: number;
  readonly allowLoopback?: boolean;
}

/**
 * @purpose Verifies that an individual HTTP/HTTPS request issued by the browser targets a legitimate public endpoint.
 * @rationale Intercepts every outbound subresource, fetch, XHR, and redirect hop, validating syntax, denylist suffixes, and DNS-resolved IP subnets.
 * @preconditions targetUrl is a non-empty string.
 * @param targetUrl Outbound request URL string to inspect.
 * @param opts Optional execution controls including AbortSignal and loopback allowance.
 * @returns Promise resolving if request is permitted.
 * @throws DomainError BAD_REQUEST if target is internal, private IP, unsupported protocol, or aborted.
 * @invariants O(1) syntax check + cached DNS resolution; zero trust.
 */
export async function assertPublicRequest(
  targetUrl: string,
  opts?: { signal?: AbortSignal; allowLoopback?: boolean },
): Promise<void> {
  const check = checkPublicUrl(targetUrl, { allowLoopback: opts?.allowLoopback });
  if (!check.ok) {
    throw new DomainError('BAD_REQUEST', `Request to "${targetUrl}" rejected: ${check.reason}`);
  }
  await assertPublicUrl(check.url, opts);
}

/**
 * @purpose Installs a comprehensive request interception guard on an active browser page.
 * @rationale Enforces request-level SSRF defense on all hops, blocks non-essential heavy resources when ultraFast is enabled, and performs in-flight charset repair on bare text/html documents.
 * @preconditions page must be an active, unclosed Page instance.
 * @param page Active Page instance to protect.
 * @param opts Configuration options for interception, SSRF notification, and loopback allowance.
 * @returns Promise resolving once the route handler is registered.
 * @throws Never throws directly; route failures are handled gracefully.
 * @invariants Intercepts all outbound page requests via wildcard route; thread-safe.
 */
export async function installRequestGuard(
  page: Page,
  opts: {
    signal?: AbortSignal;
    ultraFast?: boolean;
    allowLoopback?: boolean;
    onSsrfBlocked?: (url: string) => void;
  },
): Promise<void> {
  const blockedTypes = new Set(webResearchConfig.blockedResourceTypes);

  await page.route('**/*', async (route: Route) => {
    const request = route.request();
    const reqUrl = request.url();

    // 1. Request-level SSRF verification across all document and subresource requests
    try {
      await assertPublicRequest(reqUrl, {
        signal: opts.signal,
        allowLoopback: opts.allowLoopback,
      });
    } catch {
      opts.onSsrfBlocked?.(reqUrl);
      await route.abort('blockedbyclient').catch(() => {});
      return;
    }

    // 2. Heavy resource blocking if ultraFast is enabled
    if (opts.ultraFast === true && blockedTypes.has(request.resourceType())) {
      await route.abort('blockedbyclient').catch(() => {});
      return;
    }

    // 3. Charset repair for main navigation document (FR-04)
    if (request.isNavigationRequest() && request.resourceType() === 'document') {
      try {
        // maxRedirects: 0 keeps 3xx responses as redirects so the browser (not route.fetch)
        // follows them; otherwise finalUrl stays pinned to the requested URL.
        const response = await route.fetch({ maxRedirects: 0 });
        const status = response.status();
        const headers = response.headers();
        const contentType = headers['content-type'] || headers['Content-Type'] || '';

        // Preserve redirects and non-HTML responses untouched
        if (status < 200 || status >= 300) {
          await route.fulfill({ response });
          return;
        }

        // Check if content-type is text/html without an explicit charset
        if (
          contentType.toLowerCase().startsWith('text/html') &&
          !contentType.toLowerCase().includes('charset=')
        ) {
          const bodyBuffer = await response.body();
          // Inspect the first 1024 bytes for a declared meta charset tag
          const prefix = bodyBuffer.subarray(0, 1024).toString('latin1');
          const hasDeclaredCharset =
            /<meta[^>]+charset=["']?([^"'>\s/]+)/i.test(prefix) ||
            /<meta[^>]+http-equiv=["']?content-type["']?[^>]+content=["'][^"']*charset=([^"'>\s/]+)/i.test(
              prefix,
            );

          if (!hasDeclaredCharset) {
            // Fulfill with corrected UTF-8 charset header to prevent Chrome windows-1252 mojibake
            const correctedHeaders = {
              ...headers,
              'content-type': 'text/html; charset=utf-8',
            };
            await route.fulfill({
              response,
              headers: correctedHeaders,
              body: bodyBuffer,
            });
            return;
          }
        }

        await route.fulfill({ response });
        return;
      } catch {
        // Fallback to default routing on fetch error
      }
    }

    await route.fallback().catch(() => {});
  });
}

/**
 * @purpose Polls page readyState and URL stability until dynamic document settling occurs.
 * @rationale Waits for client-side SPAs, meta-refresh directives, and immediate JavaScript redirects to stabilize before extracting DOM contents.
 * @preconditions page must have completed initial goto call.
 * @param page Active Page instance.
 * @param opts Settling parameters including poll interval and max stabilization timeout.
 * @returns Promise resolving once page stabilizes or timeout elapses.
 * @throws Never throws directly; settles gracefully upon timeout.
 * @invariants Bounded loop; poll interval SETTLE_POLL_MS; maximum duration bounded by stabilizeTimeoutMs.
 */
export async function settleDocument(
  page: Page,
  opts?: {
    settlePollMs?: number;
    stabilizeTimeoutMs?: number;
    signal?: AbortSignal;
  },
): Promise<void> {
  const pollMs = opts?.settlePollMs ?? webResearchConfig.settlePollMs;
  const timeoutMs = opts?.stabilizeTimeoutMs ?? webResearchConfig.stabilizeTimeoutMs;
  const deadline = Date.now() + timeoutMs;

  let lastUrl = page.url();
  let stableIterations = 0;

  while (Date.now() < deadline) {
    if (opts?.signal?.aborted) break;

    await new Promise((resolve) => setTimeout(resolve, pollMs));

    let currentUrl = '';
    let readyState = '';
    try {
      currentUrl = page.url();
      readyState = await page.evaluate(() => document.readyState).catch(() => '');
    } catch {
      // If evaluating state fails during navigation, continue loop
      continue;
    }

    const isReady = readyState === 'interactive' || readyState === 'complete';
    if (currentUrl === lastUrl && isReady) {
      stableIterations++;
      if (stableIterations >= 2) {
        break;
      }
    } else {
      stableIterations = 0;
      lastUrl = currentUrl;
    }
  }
}

/**
 * @purpose Safely captures page HTML and metadata with bounded retries against transient navigation races.
 * @rationale Guards against "Execution context was destroyed" or "Unable to retrieve content because the page is navigating" errors during capture.
 * @preconditions page must be an active Page instance.
 * @param page Active Page instance.
 * @param maxRetries Maximum retry attempts (default 3).
 * @returns Promise resolving to captured HTML, title, and meta description.
 * @throws DomainError if capture fails after maximum retries.
 * @invariants Max retries bounded; Big-O time complexity O(n) where n is HTML byte length.
 */
export async function captureHtmlSafely(
  page: Page,
  maxRetries = 3,
): Promise<{ html: string; title: string; description: string | null }> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const html = await page.content();
      const meta = await page
        .evaluate(() => {
          const docTitle = document.title || '';
          const heading = document.querySelector('h1')?.textContent?.trim() || '';
          const desc =
            document.querySelector('meta[name="description" i]')?.getAttribute('content') ||
            document.querySelector('meta[property="og:description" i]')?.getAttribute('content') ||
            document.querySelector('meta[name="twitter:description" i]')?.getAttribute('content') ||
            null;
          return {
            title: docTitle || heading || '',
            desc,
          };
        })
        .catch(() => ({ title: '', desc: null }));

      return {
        html,
        title: meta.title,
        description: meta.desc,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (
        (msg.includes('navigating') ||
          msg.includes('destroyed') ||
          msg.includes('Target closed')) &&
        attempt < maxRetries - 1
      ) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        continue;
      }
      throw new DomainError('INTERNAL_SERVER_ERROR', `Failed to capture page content: ${msg}`);
    }
  }

  throw new DomainError('INTERNAL_SERVER_ERROR', 'Failed to capture page content after retries');
}

/**
 * @purpose High-level navigation and capture orchestrator implementing full SSRF guards, redirect tracking, and content classification.
 * @rationale Navigates to target URL with Patchright stealth, intercepts subresources, settles DOM, handles HTTP status codes, and returns typed NavResult without throwing for classified web outcomes.
 * @preconditions page is an active Page instance; url passes initial string validation.
 * @param page Active Page instance.
 * @param targetUrl Destination URL string or URL instance.
 * @param opts Navigation and capture options.
 * @returns Promise resolving to comprehensive NavResult object.
 * @throws DomainError only for unhandled fatal process failures; all classified web errors return as NavResult.
 * @invariants Idempotent execution; never throws for 404, 503, SSRF block, PDF, or 204; thread-safe.
 */
export async function navigateAndCapture(
  page: Page,
  targetUrl: string | URL,
  opts: NavigateOptions = {},
): Promise<NavResult> {
  const urlStr = typeof targetUrl === 'string' ? targetUrl : targetUrl.toString();
  const maxRedirects = opts.maxRedirects ?? webResearchConfig.maxRedirects;
  const timeout = opts.timeoutMs ?? webResearchConfig.browserTimeoutMs;

  let ssrfBlocked = false;
  let ssrfReason: string | undefined;

  // Track SSRF blocks from request interceptor
  await installRequestGuard(page, {
    signal: opts.signal,
    ultraFast: opts.ultraFast,
    allowLoopback: opts.allowLoopback,
    onSsrfBlocked: (blockedTarget) => {
      ssrfBlocked = true;
      ssrfReason = `Blocked request to private/reserved target "${blockedTarget}"`;
    },
  });

  // Track redirects and HTTP responses
  let redirectCount = 0;
  let lastResponse: Response | null = null;

  const onResponse = (resp: Response) => {
    if (resp.request().isNavigationRequest()) {
      lastResponse = resp;
      if (resp.status() >= 300 && resp.status() <= 399) {
        redirectCount++;
      }
    }
  };
  page.on('response', onResponse);

  try {
    const mainResponse = await page.goto(urlStr, {
      waitUntil: 'domcontentloaded',
      timeout,
    });

    if (mainResponse) {
      lastResponse = mainResponse;
    }

    // Check if SSRF guard caught a hop or subresource during goto
    if (ssrfBlocked) {
      return {
        status: null,
        contentType: null,
        finalUrl: resolveLandedUrl(page, lastResponse, urlStr),
        redirectCount,
        html: '',
        title: '',
        description: null,
        htmlTruncated: false,
        outcome: 'ssrf',
        reason: ssrfReason || 'ssrf_blocked',
      };
    }

    // Settle dynamic DOM (meta-refresh, SPA routing)
    await settleDocument(page, {
      settlePollMs: opts.settlePollMs,
      stabilizeTimeoutMs: opts.stabilizeTimeoutMs,
      signal: opts.signal,
    });

    const finalUrl = resolveLandedUrl(page, lastResponse, urlStr);
    const status = lastResponse ? lastResponse.status() : 200;
    const contentType = lastResponse ? lastResponse.headers()['content-type'] || null : null;

    // Check redirect loop
    if (redirectCount > maxRedirects) {
      return {
        status,
        contentType,
        finalUrl,
        redirectCount,
        html: '',
        title: '',
        description: null,
        htmlTruncated: false,
        outcome: 'redirect_loop',
        reason: 'Too many redirects exceeded configured limit',
      };
    }

    // Check empty content (e.g. 204 No Content)
    if (status === 204) {
      return {
        status: 204,
        contentType,
        finalUrl,
        redirectCount,
        html: '',
        title: '',
        description: null,
        htmlTruncated: false,
        outcome: 'empty_content',
        reason: 'HTTP 204 No Content returned',
      };
    }

    // Check unsupported content (e.g. PDF, application/octet-stream)
    if (contentType) {
      const lowerCt = contentType.toLowerCase();
      if (
        lowerCt.includes('application/pdf') ||
        lowerCt.includes('application/octet-stream') ||
        lowerCt.startsWith('image/') ||
        lowerCt.startsWith('video/') ||
        lowerCt.startsWith('audio/')
      ) {
        return {
          status,
          contentType,
          finalUrl,
          redirectCount,
          html: '',
          title: '',
          description: null,
          htmlTruncated: false,
          outcome: 'unsupported_content',
          reason: `Unsupported media type: ${contentType}`,
        };
      }
    }

    // Capture settled HTML and metadata safely
    const captured = await captureHtmlSafely(page);
    if (!captured.html || captured.html.trim() === '') {
      return {
        status,
        contentType,
        finalUrl,
        redirectCount,
        html: '',
        title: captured.title,
        description: captured.description,
        htmlTruncated: false,
        outcome: 'empty_content',
        reason: 'Page body contained zero content',
      };
    }

    return {
      status,
      contentType,
      finalUrl,
      redirectCount,
      html: captured.html,
      title: captured.title,
      description: captured.description,
      htmlTruncated: false,
      outcome: 'success',
    };
  } catch (err: unknown) {
    if (ssrfBlocked) {
      return {
        status: null,
        contentType: null,
        finalUrl: resolveLandedUrl(page, lastResponse, urlStr),
        redirectCount,
        html: '',
        title: '',
        description: null,
        htmlTruncated: false,
        outcome: 'ssrf',
        reason: ssrfReason || 'ssrf_blocked',
      };
    }

    const msg = err instanceof Error ? err.message : String(err);

    // 204 No Content aborts navigation before any document exists (EC-07)
    if (lastResponse && lastResponse.status() === 204) {
      return {
        status: 204,
        contentType: lastResponse.headers()['content-type'] || null,
        finalUrl: resolveLandedUrl(page, lastResponse, urlStr),
        redirectCount,
        html: '',
        title: '',
        description: null,
        htmlTruncated: false,
        outcome: 'empty_content',
        reason: 'HTTP 204 No Content returned',
      };
    }

    if (msg.includes('ERR_TOO_MANY_REDIRECTS')) {
      return {
        status: null,
        contentType: null,
        finalUrl: resolveLandedUrl(page, lastResponse, urlStr),
        redirectCount,
        html: '',
        title: '',
        description: null,
        htmlTruncated: false,
        outcome: 'redirect_loop',
        reason: 'ERR_TOO_MANY_REDIRECTS',
      };
    }

    if (msg.includes('Timeout') || msg.includes('timeout')) {
      return {
        status: null,
        contentType: null,
        finalUrl: resolveLandedUrl(page, lastResponse, urlStr),
        redirectCount,
        html: '',
        title: '',
        description: null,
        htmlTruncated: false,
        outcome: 'timeout',
        reason: msg,
      };
    }

    if (msg.includes('ERR_ABORTED') || msg.includes('Download is starting')) {
      return {
        status: lastResponse ? lastResponse.status() : null,
        contentType: lastResponse ? lastResponse.headers()['content-type'] || null : null,
        finalUrl: resolveLandedUrl(page, lastResponse, urlStr),
        redirectCount,
        html: '',
        title: '',
        description: null,
        htmlTruncated: false,
        outcome: 'unsupported_content',
        reason: 'Download or non-renderable media aborted by browser',
      };
    }

    // Try to capture whatever content was rendered if possible (e.g. 404 / 503 custom error pages)
    try {
      const captured = await captureHtmlSafely(page, 1);
      if (captured.html && captured.html.trim().length > 0) {
        return {
          status: lastResponse ? lastResponse.status() : null,
          contentType: lastResponse ? lastResponse.headers()['content-type'] || null : null,
          finalUrl: resolveLandedUrl(page, lastResponse, urlStr),
          redirectCount,
          html: captured.html,
          title: captured.title,
          description: captured.description,
          htmlTruncated: false,
          outcome: 'success',
        };
      }
    } catch {}

    return {
      status: lastResponse ? lastResponse.status() : null,
      contentType: null,
      finalUrl: resolveLandedUrl(page, lastResponse, urlStr),
      redirectCount,
      html: '',
      title: '',
      description: null,
      htmlTruncated: false,
      outcome: 'error',
      reason: msg,
    };
  } finally {
    page.off('response', onResponse);
  }
}
