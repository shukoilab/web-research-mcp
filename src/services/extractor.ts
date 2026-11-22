/**
 * @purpose Content extraction, URL absolutization, Markdown budgeting, and anti-bot wall detection pipeline.
 * @rationale Parses raw webpage HTML with Linkedom, resolves relative URLs against final landed location, filters boilerplate via Mozilla Readability, and compiles token-efficient GitHub Flavored Markdown with strict paragraph-boundary truncation.
 * @preconditions rawHtml must be a valid HTML string; finalUrl must be a valid URL string or undefined.
 * @invariants Pure in-memory transformation; Big-O time complexity O(n); surrogate-pair safe UTF-16 truncation; zero synthetic metadata fabrication.
 */

import { Readability } from '@mozilla/readability';
import { DomainError } from '@shukoi/core';
import { parseHTML } from 'linkedom';
import rehypeParse from 'rehype-parse';
import rehypeRemark from 'rehype-remark';
import remarkGfm from 'remark-gfm';
import remarkStringify from 'remark-stringify';
import { unified } from 'unified';
import { webResearchConfig } from '../config.js';
import { BrowserManager, smartScrollAndHydrate } from './browser.js';
import { type NavResult, navigateAndCapture } from './navigation.js';
import { validatePublicUrl } from './ssrf.js';

/**
 * @purpose Structured output result of content extraction.
 * @rationale Encapsulates metadata, article text, high-fidelity Markdown, truncation flag, and bot-wall indicators.
 * @invariants Readonly data structure.
 */
export interface ExtractedArticle {
  readonly title: string;
  readonly byline: string | null;
  readonly excerpt: string | null;
  readonly markdown: string;
  readonly truncated: boolean;
  readonly blocked: boolean;
  readonly blockReason?: string;
}

// Reusable Unified AST processing pipeline instance
const markdownProcessor = unified()
  .use(rehypeParse, { fragment: true })
  .use(rehypeRemark)
  .use(remarkGfm)
  .use(remarkStringify);

/**
 * @purpose Compresses Markdown by pruning redundant dividers, empty links, and excessive blank lines.
 * @rationale Minimizes LLM context window token consumption while preserving authentic content structure.
 * @preconditions rawMd is a valid string.
 * @param rawMd Uncompressed Markdown string.
 * @returns Cleaned and compressed Markdown string.
 * @throws Never throws.
 * @invariants Pure string transformation; Big-O time complexity O(n).
 */
export function compressMarkdown(rawMd: string): string {
  return rawMd
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\[\s*\]\([^)]*\)/g, '')
    .replace(/^[-=]{5,}$/gm, '---')
    .trim();
}

/**
 * @purpose Enforces character budget on Markdown content with clean paragraph-boundary truncation and surrogate-pair safety.
 * @rationale Prevents unbounded token consumption without corrupting Unicode characters or splitting sentences arbitrarily.
 * @preconditions markdown is a string; maxChars is a non-negative integer.
 * @param markdown Source Markdown string to truncate.
 * @param maxChars Maximum character limit.
 * @returns Object with bounded text and boolean truncated indicator.
 * @throws Never throws directly.
 * @invariants Bounded length; surrogate-pair safe; Big-O time complexity O(n).
 */
export function truncateMarkdown(
  markdown: string,
  maxChars = webResearchConfig.maxMarkdownChars,
): { text: string; truncated: boolean } {
  if (markdown.length <= maxChars) {
    return { text: markdown, truncated: false };
  }

  // Find the last paragraph boundary before maxChars
  let cutIndex = markdown.lastIndexOf('\n\n', maxChars);
  if (cutIndex < maxChars / 2) {
    cutIndex = maxChars;
  }

  // Guarantee surrogate pair safety: avoid splitting between high and low surrogates
  if (cutIndex > 0) {
    const code = markdown.charCodeAt(cutIndex - 1);
    if (code >= 0xd800 && code <= 0xdbff) {
      cutIndex--;
    }
  }

  const truncatedText = `${markdown.slice(0, cutIndex).trim()}\n\n[Content truncated due to size budget]`;
  return { text: truncatedText, truncated: true };
}

/**
 * @purpose Converts an HTML string or fragment into clean GitHub Flavored Markdown (GFM).
 * @rationale Preserves tabular structures, headers, lists, code blocks, and formatted text while stripping scripts, styles, and decorative tags using Linkedom DOM fallback.
 * @preconditions html is a non-empty string.
 * @param html Cleaned HTML fragment.
 * @returns Serialized Markdown string.
 * @throws Never throws directly; AST errors produce sanitized Linkedom fallback string.
 * @invariants Big-O time complexity O(n); pure serialization; zero regex-based script stripping.
 */
export async function convertHtmlToMarkdown(html: string): Promise<string> {
  if (!html || html.trim() === '') {
    return '';
  }
  try {
    const vfile = await markdownProcessor.process(html);
    return compressMarkdown(String(vfile));
  } catch {
    // Robust Linkedom DOM fallback stripping non-content elements without fragile regexes
    try {
      const { document } = parseHTML(html);
      for (const el of document.querySelectorAll('script, style, noscript, svg, iframe')) {
        el.remove();
      }
      return compressMarkdown(document.body?.textContent || '');
    } catch {
      return '';
    }
  }
}

/**
 * @purpose Ingests raw webpage HTML, absolutizes links, strips boilerplate, and produces structured article Markdown.
 * @rationale Employs Mozilla Readability heuristics with deterministic fallback to main/body elements, absolutizes links against final landed URL, and detects bot/login walls without fabricating content.
 * @preconditions rawHtml must be a valid HTML string; input size is checked against maxContentLength.
 * @param rawHtml Raw source HTML from browser or fetch response.
 * @param fallbackTitle Optional fallback title if DOM lacks title elements.
 * @param fallbackDescription Optional pre-hydration meta description.
 * @param finalUrl Optional landed URL for resolving relative links and media sources.
 * @returns ExtractedArticle containing clean title, byline, excerpt, Markdown, and status flags.
 * @throws Never throws unhandled; returns fallback payload on parse degradation.
 * @invariants Memory bounded by webResearchConfig.maxContentLength; pure DOM manipulation.
 */
export async function extractContentToMarkdown(
  rawHtml: string,
  fallbackTitle = 'Untitled',
  fallbackDescription?: string,
  finalUrl?: string,
): Promise<ExtractedArticle> {
  const boundedHtml =
    rawHtml.length > webResearchConfig.maxContentLength
      ? rawHtml.slice(0, webResearchConfig.maxContentLength)
      : rawHtml;

  const { document } = parseHTML(boundedHtml);

  // 1. Resolve every relative href, src, and srcset against finalUrl before Readability (FR-05)
  if (finalUrl) {
    try {
      const base = new URL(finalUrl);
      for (const a of document.querySelectorAll('a[href]')) {
        const raw = a.getAttribute('href');
        if (
          raw &&
          !raw.startsWith('javascript:') &&
          !raw.startsWith('#') &&
          !raw.startsWith('mailto:')
        ) {
          try {
            a.setAttribute('href', new URL(raw, base).href);
          } catch {}
        }
      }
      for (const img of document.querySelectorAll('img[src]')) {
        const raw = img.getAttribute('src');
        if (raw && !raw.startsWith('data:')) {
          try {
            img.setAttribute('src', new URL(raw, base).href);
          } catch {}
        }
      }
      for (const el of document.querySelectorAll('[srcset]')) {
        const raw = el.getAttribute('srcset');
        if (raw) {
          try {
            const rewritten = raw
              .split(',')
              .map((part) => {
                const trimmed = part.trim();
                const [src, descriptor] = trimmed.split(/\s+/, 2);
                if (src && !src.startsWith('data:')) {
                  try {
                    const abs = new URL(src, base).href;
                    return descriptor ? `${abs} ${descriptor}` : abs;
                  } catch {
                    return trimmed;
                  }
                }
                return trimmed;
              })
              .join(', ');
            el.setAttribute('srcset', rewritten);
          } catch {}
        }
      }
    } catch {
      // Ignore base URL resolution failures
    }
  }

  // 2. Extract metadata descriptors
  const metaDescription =
    document.querySelector('meta[name="description" i]')?.getAttribute('content')?.trim() ||
    document.querySelector('meta[property="og:description" i]')?.getAttribute('content')?.trim() ||
    document.querySelector('meta[name="twitter:description" i]')?.getAttribute('content')?.trim() ||
    fallbackDescription?.trim() ||
    null;

  const ogTitle =
    document.querySelector('meta[property="og:title" i]')?.getAttribute('content')?.trim() ||
    document.querySelector('meta[name="twitter:title" i]')?.getAttribute('content')?.trim() ||
    null;

  // 3. Remove noisy elements (navigation, dialogs, modals, ads, and tracking)
  const noisyElements = document.querySelectorAll(
    'script, style, noscript, svg, iframe, canvas, [role="dialog"], [class*="cookie"], [id*="cookie"]',
  );
  for (const el of noisyElements) {
    el.remove();
  }

  // 4. Remove token-wasting decorative avatars and profile thumbnails
  const avatarImages = document.querySelectorAll(
    'img[alt*="profil" i], img[alt*="avatar" i], img[src*="avatar" i], img[src*="profile" i], img[src*="icon" i]',
  );
  for (const img of avatarImages) {
    img.remove();
  }

  // 5. Determine title candidate hierarchy
  const headingTitle = document.querySelector('h1')?.textContent?.trim();
  const documentTitle = document.querySelector('title')?.textContent?.trim();
  const pageTitle = headingTitle || documentTitle || ogTitle || fallbackTitle;

  // 6. Parse through Mozilla Readability
  let articleContentHtml = '';
  let articleTitle = pageTitle;
  let articleByline: string | null = null;
  let articleExcerpt: string | null = metaDescription;

  try {
    const reader = new Readability(document as unknown as Document, {
      charThreshold: webResearchConfig.readabilityCharThreshold,
    });
    const parsedArticle = reader.parse();

    if (parsedArticle?.content) {
      articleContentHtml = parsedArticle.content;
      articleTitle = headingTitle || parsedArticle.title || ogTitle || pageTitle;
      articleByline = parsedArticle.byline || null;
      articleExcerpt = parsedArticle.excerpt || metaDescription || null;
    }
  } catch {
    // Readability parse failure triggers fallback below
  }

  // 7. Deterministic Fallback if Readability yields empty content
  if (!articleContentHtml || articleContentHtml.trim() === '') {
    const mainEl =
      document.querySelector('main') ||
      document.querySelector('article') ||
      document.querySelector('div[role="main"]') ||
      document.body;

    if (mainEl) {
      const remainingNoise = mainEl.querySelectorAll(
        'script, style, noscript, nav, header, footer, svg, iframe',
      );
      for (const el of remainingNoise) {
        el.remove();
      }
      articleContentHtml = mainEl.innerHTML;
    }
  }

  // 8. Compile and compress to Markdown
  const rawMarkdown = await convertHtmlToMarkdown(articleContentHtml);

  // 9. Detect login gates or anti-bot verification walls using configurable patterns (FR-18)
  const wallPatterns = webResearchConfig.botWallPatterns;
  let isWallDetected = false;
  let matchedReason: string | undefined;

  for (const pattern of wallPatterns) {
    const match = rawMarkdown.match(pattern);
    if (match) {
      isWallDetected = true;
      matchedReason = `Anti-bot or login wall detected: "${match[0].trim().slice(0, 120)}"`;
      break;
    }
  }

  // 10. Enforce Markdown budget with paragraph-boundary cut (FR-15)
  const { text: budgetedMarkdown, truncated } = truncateMarkdown(
    rawMarkdown,
    webResearchConfig.maxMarkdownChars,
  );

  return {
    title: articleTitle,
    byline: articleByline,
    excerpt: articleExcerpt,
    markdown: budgetedMarkdown,
    truncated,
    blocked: isWallDetected,
    blockReason: isWallDetected ? matchedReason : undefined,
  };
}

/**
 * @purpose Determines whether extracted Markdown meets the minimum viable content threshold.
 * @rationale Pages that render only an anti-bot interstitial or a hydration skeleton yield a handful of characters; reporting them as a successful extraction misleads callers into treating noise as content.
 * @preconditions markdown is the extracted Markdown string; minimumChars is a non-negative threshold.
 * @param markdown Extracted Markdown body.
 * @param minimumChars Minimum trimmed character count considered viable content.
 * @returns True when the trimmed Markdown length meets or exceeds minimumChars.
 * @throws Never throws.
 * @invariants Pure; Big-O time complexity O(n) for trim; thread-safe.
 */
export function hasViableContent(markdown: string, minimumChars: number): boolean {
  return markdown.trim().length >= minimumChars;
}

/**
 * @purpose Execution options for single URL content extraction.
 * @rationale Configures crawler navigation behavior, stealth resource blocking, dynamic DOM hydration, and unfolding.
 * @invariants Readonly options object.
 */
export interface SingleUrlExtractOptions {
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  readonly smartScroll?: boolean;
  readonly scrollDelayMs?: number;
  readonly maxScrolls?: number;
  readonly ultraFast?: boolean;
  readonly unfoldInteractive?: boolean;
}

/**
 * @purpose Structured output result of single URL content acquisition and extraction.
 * @rationale Delivers raw HTML alongside extracted Markdown, landed URL, HTTP status, and diagnostic flags.
 * @invariants Readonly data structure.
 */
export interface SingleUrlExtractResult {
  readonly rawHtml: string;
  readonly title: string;
  readonly byline: string | null;
  readonly excerpt: string | null;
  readonly markdown: string;
  readonly finalUrl: string;
  readonly status: number | null;
  readonly redirectCount: number;
  readonly truncated: boolean;
  readonly blocked: boolean;
  readonly blockReason?: string;
}

/**
 * @purpose Navigates to a single public URL and extracts high-density Markdown and metadata using resilient request-level guards.
 * @rationale Encapsulates stealth browser acquisition, request-level SSRF guards, DOM settling, and unified Markdown serialization into a reusable service function.
 * @preconditions Input url must pass validatePublicUrl or be an already-validated URL object; signal is not aborted.
 * @param url Target HTTP/HTTPS URL string or validated URL object to navigate and extract.
 * @param opts Optional extraction options.
 * @returns Promise resolving to SingleUrlExtractResult containing full metadata and Markdown.
 * @throws DomainError BAD_REQUEST on SSRF violation, invalid URL, or unsupported media, GATEWAY_TIMEOUT on timeout, SERVICE_UNAVAILABLE on browser context failure.
 * @invariants Page handle closed in finally block; semaphore bounded; zero zombie browser processes.
 */
export async function extractSingleUrlContent(
  url: string | URL,
  opts: SingleUrlExtractOptions = {},
): Promise<SingleUrlExtractResult> {
  const validatedUrl = typeof url === 'string' ? validatePublicUrl(url) : url;
  const browserManager = BrowserManager.getInstance();

  const navResult: NavResult = await browserManager.withPage(
    async (page) => {
      const result = await navigateAndCapture(page, validatedUrl, {
        signal: opts.signal,
        timeoutMs: opts.timeoutMs,
        ultraFast: opts.ultraFast,
      });

      // Execute smart progressive scrolling for dynamic SPAs and lazy XHR elements if navigation was successful
      if (result.outcome === 'success' && opts.smartScroll !== false) {
        await smartScrollAndHydrate(page, {
          maxScrolls: opts.maxScrolls,
          scrollDelayMs: opts.scrollDelayMs,
          unfoldInteractive: opts.unfoldInteractive,
        });
      }

      return result;
    },
    {
      signal: opts.signal,
      timeoutMs: opts.timeoutMs,
    },
  );

  // Handle classified navigation outcomes
  if (navResult.outcome === 'ssrf') {
    throw new DomainError(
      'BAD_REQUEST',
      navResult.reason || 'Access to private or reserved target is prohibited',
    );
  }
  if (navResult.outcome === 'redirect_loop') {
    throw new DomainError(
      'BAD_REQUEST',
      navResult.reason || 'Redirect loop or too many redirects encountered',
    );
  }
  if (navResult.outcome === 'unsupported_content') {
    throw new DomainError(
      'BAD_REQUEST',
      navResult.reason || 'Target URL returned unsupported non-HTML media content',
    );
  }
  if (navResult.outcome === 'empty_content') {
    throw new DomainError(
      'BAD_REQUEST',
      navResult.reason || 'Target webpage returned empty content',
    );
  }
  if (navResult.outcome === 'timeout') {
    throw new DomainError(
      'GATEWAY_TIMEOUT',
      navResult.reason || 'Navigation to target URL timed out',
    );
  }
  if (navResult.outcome === 'error') {
    throw new DomainError(
      'INTERNAL_SERVER_ERROR',
      navResult.reason || 'Navigation execution failed',
    );
  }

  // Extract article, sanitize noise, absolutize links, and compile to high-density Markdown
  const fallbackTitle =
    navResult.title && navResult.title.trim() !== ''
      ? navResult.title.trim()
      : validatedUrl.hostname;

  const extracted = await extractContentToMarkdown(
    navResult.html,
    fallbackTitle,
    navResult.description || undefined,
    navResult.finalUrl,
  );

  // A detected wall is reported via `blocked`; otherwise near-empty output is indistinguishable from an empty body.
  if (
    !extracted.blocked &&
    !hasViableContent(extracted.markdown, webResearchConfig.readabilityCharThreshold)
  ) {
    throw new DomainError(
      'BAD_REQUEST',
      `Target webpage produced empty content: extracted Markdown was ${extracted.markdown.trim().length} characters (minimum ${webResearchConfig.readabilityCharThreshold})`,
    );
  }

  return {
    rawHtml: navResult.html,
    title: extracted.title,
    byline: extracted.byline,
    excerpt: extracted.excerpt,
    markdown: extracted.markdown,
    finalUrl: navResult.finalUrl,
    status: navResult.status,
    redirectCount: navResult.redirectCount,
    truncated: extracted.truncated,
    blocked: extracted.blocked,
    blockReason: extracted.blockReason,
  };
}
