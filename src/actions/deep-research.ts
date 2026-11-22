/**
 * @purpose Protocol-agnostic Deep Research action (`deepResearchAction`) exposed over REST and MCP.
 * @rationale Automates end-to-end multi-source research by searching Google, extracting top-N canonical URLs sequentially to high-density Markdown, and enforcing strict token and time budgets.
 * @preconditions Input query must be a valid non-empty string; environment browser pool must be operational.
 * @invariants Pure Web-Standard action; zero node:* imports; additionalProperties: false enforced on all schemas.
 */

import { defineAction } from '@shukoi/core';
import { FormatRegistry, Type } from '@sinclair/typebox';
import { DEFAULTS } from '../config.js';
import { executeDeepResearch } from '../services/deep-research.js';

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
 * @purpose Deep research action definition implementing the Shukoi action contract.
 * @rationale Delivers bulk multi-source web research with sequential page extraction, anti-bot bypass, SSRF boundary isolation, and strict character budget controls.
 * @invariants Strict TypeBox contract; propagates ctx.signal; pure web-standard implementation; static timeout ceiling.
 */
export const deepResearchAction = defineAction({
  name: 'deepResearch',
  summary:
    'Execute multi-source deep web research combining Google Search and sequential full-page extraction',
  description:
    'Executes comprehensive, multi-source deep web research in a single call. Conducts Google Search, extracts top-N canonical search results sequentially into clean GitHub Flavored Markdown, filters boilerplate and anti-bot walls, and truncates results within strict per-result and total token budgets. Use this tool when you need full article content or synthesis across multiple sources for a research topic. For surgical single-page extraction when a target URL is already known, use `webExtract`. For query exploration or snippet triage, use `googleSearch`.',
  authRequired: false,
  timeoutMs: DEFAULTS.DEEP_RESEARCH_BUDGET_MS + 10000,
  http: {
    method: 'POST',
    path: '/actions/deep-research',
    successStatus: 200,
  },
  mcp: {
    enabled: true,
    entityType: 'tool',
    annotations: {
      title: 'Deep Web Researcher',
      readOnlyHint: true,
      openWorldHint: true,
    },
  },
  input: Type.Object(
    {
      query: Type.String({
        minLength: 1,
        maxLength: 500,
        description: 'Search keywords or research query',
      }),
      limit: Type.Optional(
        Type.Integer({
          minimum: 1,
          maximum: 10,
          default: 5,
          description:
            'Maximum number of search results to extract sequentially (1-10, default: 5)',
        }),
      ),
      language: Type.Optional(
        Type.String({
          minLength: 2,
          maxLength: 5,
          default: 'en',
          description: 'Search interface language code (e.g. "en", "id")',
        }),
      ),
      country: Type.Optional(
        Type.String({
          minLength: 2,
          maxLength: 5,
          default: 'us',
          description: 'Geolocation country code for localized search results (e.g. "us", "id")',
        }),
      ),
      safeSearch: Type.Optional(
        Type.Boolean({
          default: true,
          description: 'Whether to enable Google SafeSearch content filtering (default: true)',
        }),
      ),
      ultraFast: Type.Optional(
        Type.Boolean({
          default: true,
          description:
            'Block images, external CSS, fonts, and media during page extraction. Defaults to true for deep research to maximize throughput and minimize network latency.',
        }),
      ),
      smartScroll: Type.Optional(
        Type.Boolean({
          default: true,
          description:
            'Automatically scroll and wait for lazy-loaded XHR data to settle (default: true)',
        }),
      ),
      scrollDelayMs: Type.Optional(
        Type.Integer({
          minimum: 100,
          maximum: 5000,
          default: DEFAULTS.SCROLL_DELAY_MS,
          description: 'Debounce wait time in milliseconds after each scroll step (default: 500)',
        }),
      ),
      maxScrolls: Type.Optional(
        Type.Integer({
          minimum: 0,
          maximum: 20,
          default: DEFAULTS.MAX_SCROLL_STEPS,
          description: 'Maximum scroll step iterations for lazy content hydration (default: 6)',
        }),
      ),
      timeoutMs: Type.Optional(
        Type.Integer({
          minimum: 1000,
          maximum: 60000,
          default: DEFAULTS.PAGE_TIMEOUT_MS,
          description: 'Per-page navigation timeout in milliseconds (default: 30000)',
        }),
      ),
      maxCharsPerResult: Type.Optional(
        Type.Integer({
          minimum: 100,
          maximum: 100000,
          default: 20000,
          description:
            'Maximum character length per extracted article before truncation (default: 20000)',
        }),
      ),
      maxTotalChars: Type.Optional(
        Type.Integer({
          minimum: 100,
          maximum: 500000,
          default: DEFAULTS.MAX_MARKDOWN_CHARS,
          description:
            'Maximum total character budget across all extracted articles (default: 100000)',
        }),
      ),
    },
    { additionalProperties: false },
  ),
  output: Type.Object(
    {
      query: Type.String({ description: 'Original research query' }),
      totalFound: Type.Integer({ description: 'Total search results discovered' }),
      totalReturned: Type.Integer({
        description: 'Total articles successfully extracted and returned',
      }),
      excludedCount: Type.Integer({
        description:
          'Total search results excluded due to extraction errors, SSRF, empty content, or budget exhaustion',
      }),
      errors: Type.Array(
        Type.Object(
          {
            url: Type.String({ description: 'URL of the excluded result' }),
            reason: Type.String({
              description:
                'Coded exclusion reason (e.g. ssrf_blocked, timeout, empty_content, budget_exhausted)',
            }),
          },
          { additionalProperties: false },
        ),
        { description: 'List of excluded search results with diagnostic reasons' },
      ),
      results: Type.Array(
        Type.Object(
          {
            title: Type.String({ description: 'Article or webpage title' }),
            url: Type.String({ format: 'uri', description: 'Canonical destination URL' }),
            markdown: Type.String({ description: 'Extracted content in GitHub Flavored Markdown' }),
            truncated: Type.Boolean({
              description: 'Whether the markdown was truncated by character limits',
            }),
            status: Type.Union([Type.Integer(), Type.Null()], {
              description: 'HTTP status code of the page response',
            }),
            redirectCount: Type.Integer({ description: 'Number of redirects followed' }),
          },
          { additionalProperties: false },
        ),
        { description: 'Array of successfully extracted article payloads' },
      ),
      timestamp: Type.String({ description: 'ISO-8601 execution timestamp' }),
    },
    { additionalProperties: false },
  ),
  async handler(input, ctx) {
    ctx.logger.info('Executing deep research action', {
      query: input.query,
      limit: input.limit ?? 5,
    });

    const result = await executeDeepResearch(input, ctx.signal, ctx.logger);

    ctx.logger.info('Deep research action completed', {
      query: input.query,
      totalReturned: result.totalReturned,
      excludedCount: result.excludedCount,
    });

    return result;
  },
});
