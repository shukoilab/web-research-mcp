/**
 * @purpose Protocol-agnostic Web Extraction action (`webExtractAction`) exposed over REST and MCP.
 * @rationale Navigates to a target URL with stealth browser, executes smart progressive auto-scrolling for XHR lazy-loading, and converts content into token-efficient GFM Markdown.
 * @preconditions Input URL must be a valid public HTTP/HTTPS endpoint; SSRF checks must pass.
 * @invariants Pure Web-Standard action; zero node:* imports; additionalProperties: false enforced on all schemas.
 */

import { defineAction } from '@shukoi/core';
import { FormatRegistry, Type } from '@sinclair/typebox';
import { BrowserManager, smartScrollAndHydrate } from '../services/browser.js';
import { extractContentToMarkdown } from '../services/extractor.js';
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
 * @rationale Transforms arbitrary web pages into clean LLM-friendly Markdown with SSRF immunity, auto-scroll XHR hydration, and zero token waste.
 * @invariants Strict TypeBox contract; propagates ctx.signal; pure web-standard implementation.
 */
export const webExtractAction = defineAction({
  name: 'webExtract',
  summary: 'Visit a webpage and extract token-dense Markdown',
  description:
    'Visits target webpage with stealth browser, progressively scrolls to trigger lazy-loaded XHR/SPA content, auto-clicks content expanders, and converts structured content to token-efficient GitHub Flavored Markdown.',
  authRequired: false,
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
        description: 'Target website HTTP or HTTPS URL to visit and extract',
      }),
      smartScroll: Type.Optional(
        Type.Boolean({
          default: true,
          description:
            'Automatically scroll and wait for lazy-loaded XHR data to settle (recommended for e-commerce, SPA, and modern dynamic pages)',
        }),
      ),
      scrollDelayMs: Type.Optional(
        Type.Integer({
          minimum: 100,
          maximum: 5000,
          description:
            'Debounce wait time in milliseconds after each scroll step (increase to 1000-2000ms for slow networks)',
        }),
      ),
      maxScrolls: Type.Optional(
        Type.Integer({
          minimum: 0,
          maximum: 20,
          description:
            'Maximum scroll step iterations (increase for deeply nested or long catalog pages, default: 6)',
        }),
      ),
      timeoutMs: Type.Optional(
        Type.Integer({
          minimum: 1000,
          maximum: 60000,
          default: 30000,
          description: 'Maximum navigation timeout in milliseconds (1000-60000, default: 30000)',
        }),
      ),
    },
    { additionalProperties: false },
  ),
  output: Type.Object(
    {
      url: Type.String({ description: 'Target URL visited' }),
      title: Type.String({ description: 'Extracted page or article title' }),
      byline: Type.Union([Type.String(), Type.Null()], {
        description: 'Author or publisher byline if present',
      }),
      excerpt: Type.Union([Type.String(), Type.Null()], {
        description: 'Short article summary or excerpt if present',
      }),
      markdown: Type.String({ description: 'Cleaned, high-density GitHub Flavored Markdown' }),
      timestamp: Type.String({ description: 'ISO-8601 extraction timestamp' }),
    },
    { additionalProperties: false },
  ),
  async handler(input, ctx) {
    ctx.logger.info('Executing web extract action', { url: input.url });

    // 1. Strict SSRF boundary verification
    const validatedUrl = validatePublicUrl(input.url);

    // 2. Perform stealth page acquisition, smart auto-scroll, and content retrieval
    const browserManager = BrowserManager.getInstance();

    const rawHtml = await browserManager.withPage(
      async (page) => {
        await page.goto(validatedUrl.toString(), {
          waitUntil: 'domcontentloaded',
        });

        // Execute smart progressive scrolling for dynamic SPAs and lazy XHR elements
        if (input.smartScroll !== false) {
          await smartScrollAndHydrate(page, {
            maxScrolls: input.maxScrolls,
            scrollDelayMs: input.scrollDelayMs,
          });
        }

        return await page.content();
      },
      {
        signal: ctx.signal,
        timeoutMs: input.timeoutMs,
      },
    );

    // 3. Extract article, sanitize noise, and compile to high-density Markdown
    const extracted = await extractContentToMarkdown(rawHtml, validatedUrl.hostname);

    return {
      url: input.url,
      title: extracted.title,
      byline: extracted.byline,
      excerpt: extracted.excerpt,
      markdown: extracted.markdown,
      timestamp: new Date().toISOString(),
    };
  },
});
