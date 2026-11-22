/**
 * @purpose Protocol-agnostic Web Extraction action (`webExtractAction`) exposed over REST and MCP.
 * @rationale Navigates to a target URL with stealth browser, executes smart progressive auto-scrolling for XHR lazy-loading, resolves relative links, and converts content into token-efficient GFM Markdown.
 * @preconditions Input URL must be a valid public HTTP/HTTPS endpoint; SSRF checks must pass.
 * @invariants Pure Web-Standard action; zero node:* imports; additionalProperties: false enforced on all schemas.
 */

import { defineAction } from '@shukoi/core';
import { FormatRegistry, Type } from '@sinclair/typebox';
import { DEFAULTS } from '../config.js';
import { extractSingleUrlContent } from '../services/extractor.js';
import { validatePublicUrl } from '../services/ssrf.js';

// Register standard URI format in TypeBox format registry if not already defined
if (!FormatRegistry.Has('uri')) {
  FormatRegistry.Set('uri', (value) => {
    try {
      const u = new URL(value);
      return u.protocol === 'http:' || u.protocol === 'https:';
    } catch {
      return false;
    }
  });
}

/**
 * @purpose Web extraction action definition implementing the Shukoi action contract.
 * @rationale Transforms arbitrary web pages into clean LLM-friendly Markdown with SSRF immunity, auto-scroll XHR hydration, semantic DOM unfolding, and zero token waste.
 * @invariants Strict TypeBox contract; propagates ctx.signal; pure web-standard implementation; static timeout ceiling.
 */
export const webExtractAction = defineAction({
  name: 'webExtract',
  summary: 'Fetch and read full webpage content as clean, token-dense Markdown',
  description:
    'Navigates to any public website URL using stealth browser automation, hydrates client-side rendering (SPA/XHR), unfolds collapsed content using universal W3C ARIA standards and native HTML5 disclosures, unclamps CSS line-clamping, and serializes clean GitHub Flavored Markdown. Use this as Step 2 after googleSearch by supplying the canonical URL from search results, OR as Step 1 when the user supplies a direct URL. Call this whenever search snippets are insufficient, truncated, or when complete context (tables, specifications, code blocks, full articles, reviews) is required.',
  authRequired: false,
  timeoutMs: DEFAULTS.REQUEST_BUDGET_MS + 5000,
  http: {
    method: 'POST',
    path: '/actions/web-extract',
    successStatus: 200,
  },
  mcp: {
    enabled: true,
    entityType: 'tool',
    annotations: {
      title: 'Webpage Article Extractor',
      readOnlyHint: true,
      openWorldHint: true,
    },
  },
  input: Type.Object(
    {
      url: Type.String({
        format: 'uri',
        minLength: 1,
        maxLength: 2048,
        description:
          'Target website HTTP or HTTPS URL to fetch. Accepts direct URLs or canonical URLs discovered via googleSearch.',
      }),
      smartScroll: Type.Optional(
        Type.Boolean({
          default: true,
          description:
            'Automatically scroll and wait for lazy-loaded XHR data to settle (recommended for e-commerce, SPA, and modern dynamic pages)',
        }),
      ),
      ultraFast: Type.Optional(
        Type.Boolean({
          default: false,
          description:
            'Block images, external CSS, fonts, media, and manifest (JS, XHR/fetch still run). Use for large, image-heavy or marketing pages when only text matters.',
        }),
      ),
      unfoldInteractive: Type.Optional(
        Type.Boolean({
          default: false,
          description:
            'Opt-in to interactively unfold closed accordion buttons and ARIA controls inside main/article (default: false)',
        }),
      ),
      scrollDelayMs: Type.Optional(
        Type.Integer({
          minimum: 100,
          maximum: 5000,
          default: DEFAULTS.SCROLL_DELAY_MS,
          description:
            'Debounce wait time in milliseconds after each scroll step (increase to 1000-2000ms for slow networks, default: 500)',
        }),
      ),
      maxScrolls: Type.Optional(
        Type.Integer({
          minimum: 0,
          maximum: 20,
          default: DEFAULTS.MAX_SCROLL_STEPS,
          description:
            'Maximum scroll step iterations for lazy content hydration and DOM convergence (default: 6)',
        }),
      ),
      timeoutMs: Type.Optional(
        Type.Integer({
          minimum: 1000,
          maximum: 60000,
          default: DEFAULTS.PAGE_TIMEOUT_MS,
          description: 'Maximum navigation timeout in milliseconds (1000-60000, default: 30000)',
        }),
      ),
    },
    { additionalProperties: false },
  ),
  output: Type.Object(
    {
      url: Type.String({ description: 'Target URL visited' }),
      finalUrl: Type.String({ description: 'Final landed URL after redirects' }),
      title: Type.String({ description: 'Extracted page or article title' }),
      byline: Type.Union([Type.String(), Type.Null()], {
        description: 'Author or publisher byline if present',
      }),
      excerpt: Type.Union([Type.String(), Type.Null()], {
        description: 'Short article summary or excerpt if present',
      }),
      markdown: Type.String({ description: 'Cleaned, high-density GitHub Flavored Markdown' }),
      timestamp: Type.String({ description: 'ISO-8601 extraction timestamp' }),
      status: Type.Union([Type.Integer(), Type.Null()], {
        description: 'HTTP status code of final page response',
      }),
      redirectCount: Type.Integer({ description: 'Number of HTTP redirects followed' }),
      truncated: Type.Boolean({ description: 'Whether the markdown was truncated by size budget' }),
      blocked: Type.Boolean({ description: 'Whether an anti-bot or login wall was detected' }),
    },
    { additionalProperties: false },
  ),
  async handler(input, ctx) {
    ctx.logger.info('Executing web extract action', { url: input.url });

    // 1. Strict SSRF boundary verification
    validatePublicUrl(input.url);

    // 2. Perform stealth page acquisition, smart auto-scroll, and content retrieval via shared extractor service
    const extracted = await extractSingleUrlContent(input.url, {
      signal: ctx.signal,
      timeoutMs: input.timeoutMs,
      smartScroll: input.smartScroll,
      scrollDelayMs: input.scrollDelayMs,
      maxScrolls: input.maxScrolls,
      ultraFast: input.ultraFast,
      unfoldInteractive: input.unfoldInteractive,
    });

    return {
      url: input.url,
      finalUrl: extracted.finalUrl,
      title: extracted.title,
      byline: extracted.byline,
      excerpt: extracted.excerpt,
      markdown: extracted.markdown,
      timestamp: new Date().toISOString(),
      status: extracted.status,
      redirectCount: extracted.redirectCount,
      truncated: extracted.truncated,
      blocked: extracted.blocked,
    };
  },
});
