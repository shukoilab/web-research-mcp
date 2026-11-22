import { DomainError } from '@shukoi/core';
import { createActionTestHarness } from '@shukoi/core/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deepResearchAction } from '../src/actions/deep-research.js';
import { BrowserManager } from '../src/services/browser.js';
import { applyBudget } from '../src/services/deep-research.js';

describe('Deep Research Service & Action Pipeline', () => {
  const harness = createActionTestHarness();

  beforeAll(async () => {
    await BrowserManager.getInstance().warmup();
  });

  afterAll(async () => {
    await BrowserManager.getInstance().closeAll();
  });

  describe('applyBudget Unit Tests', () => {
    it('returns exact markdown without truncation when within per-result and total limits', () => {
      const markdown = '## Heading\n\nThis is sample markdown text.';
      const result = applyBudget(markdown, 1000, 5000);
      expect(result.text).toBe(markdown);
      expect(result.truncated).toBe(false);
    });

    it('truncates content when exceeding perResultCap', () => {
      const markdown = '0123456789ABCDEF';
      const result = applyBudget(markdown, 10, 100);
      expect(result.text).toBe('0123456789');
      expect(result.truncated).toBe(true);
    });

    it('truncates content when exceeding remainingTotal budget', () => {
      const markdown = '0123456789ABCDEF';
      const result = applyBudget(markdown, 100, 5);
      expect(result.text).toBe('01234');
      expect(result.truncated).toBe(true);
    });

    it('returns empty string with truncated flag when remainingTotal is zero or negative', () => {
      const markdown = 'Valid content to truncate';
      const resultZero = applyBudget(markdown, 100, 0);
      expect(resultZero.text).toBe('');
      expect(resultZero.truncated).toBe(true);

      const resultNeg = applyBudget(markdown, 100, -50);
      expect(resultNeg.text).toBe('');
      expect(resultNeg.truncated).toBe(true);
    });

    it('returns empty string and not truncated when input markdown is empty', () => {
      const result = applyBudget('', 100, 100);
      expect(result.text).toBe('');
      expect(result.truncated).toBe(false);
    });
  });

  describe('Input Validation & Boundary Rejection', () => {
    it('rejects empty or missing query with VALIDATION_ERROR', async () => {
      await expect(harness.execute(deepResearchAction, { query: '' })).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
      });

      await expect(harness.execute(deepResearchAction, {})).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
      });
    });

    it('rejects limit out of range (0 or >10) with VALIDATION_ERROR', async () => {
      await expect(
        harness.execute(deepResearchAction, { query: 'test', limit: 0 }),
      ).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
      });

      await expect(
        harness.execute(deepResearchAction, { query: 'test', limit: 11 }),
      ).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
      });
    });

    it('rejects invalid boolean types on ultraFast with VALIDATION_ERROR', async () => {
      await expect(
        harness.execute(deepResearchAction, { query: 'test', ultraFast: 'yes' }),
      ).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
      });
    });

    it('rejects unknown additional properties on input with VALIDATION_ERROR', async () => {
      await expect(
        harness.execute(deepResearchAction, {
          query: 'test query',
          unexpectedProperty: true,
        }),
      ).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
      });
    });

    it('handles pre-aborted signal cleanly by throwing DomainError', async () => {
      const controller = new AbortController();
      controller.abort();

      await expect(
        harness.execute(
          deepResearchAction,
          { query: 'abort signal test' },
          { signal: controller.signal },
        ),
      ).rejects.toThrowError(DomainError);
    });
  });

  describe('End-to-End Orchestration & Discard Tracking', () => {
    it('executes deep research on single-card SERP and returns extracted markdown (Integration A)', async () => {
      const bm = BrowserManager.getInstance();
      const ctx = await bm.getContext();

      const mockSerpHtml = `
        <html>
          <body>
            <div class="g">
              <h3><a href="https://example.com"><cite>https://example.com</cite>Example Domain Reference</a></h3>
              <div class="VwiC3b">Illustrative example domain for documentation.</div>
            </div>
          </body>
        </html>
      `;

      await ctx.route('**/search?*', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'text/html',
          body: mockSerpHtml,
        });
      });

      try {
        const response = await harness.execute(deepResearchAction, {
          query: 'example domain',
          limit: 1,
        });

        expect(response.query).toBe('example domain');
        expect(response.totalFound).toBe(1);
        expect(response.totalReturned).toBe(1);
        expect(response.excludedCount).toBe(0);
        expect(response.errors).toEqual([]);
        expect(response.results.length).toBe(1);

        const item = response.results[0];
        expect(item?.url).toBe('https://example.com');
        expect(item?.title).toContain('Example');
        expect(item?.markdown.toLowerCase()).toContain('documentation');
        expect(item?.truncated).toBe(false);

        // Invariant verification
        expect(response.totalReturned + response.excludedCount).toBe(response.totalFound);
      } finally {
        await ctx.unroute('**/search?*');
      }
    }, 35000);

    it('discards SSRF/private IP result and preserves valid result with exact error tracking (Integration B)', async () => {
      const bm = BrowserManager.getInstance();
      const ctx = await bm.getContext();

      const mockSerpHtml = `
        <html>
          <body>
            <div class="g">
              <h3><a href="https://example.com"><cite>https://example.com</cite>Example Valid Domain</a></h3>
              <div class="VwiC3b">Valid public website.</div>
            </div>
            <div class="g">
              <h3><a href="http://127.0.0.1:9/internal"><cite>http://127.0.0.1:9 > internal</cite>Internal Admin</a></h3>
              <div class="VwiC3b">Private internal admin portal.</div>
            </div>
          </body>
        </html>
      `;

      await ctx.route('**/search?*', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'text/html',
          body: mockSerpHtml,
        });
      });

      try {
        const response = await harness.execute(deepResearchAction, {
          query: 'mixed results test',
          limit: 2,
        });

        expect(response.totalFound).toBe(2);
        expect(response.totalReturned).toBe(1);
        expect(response.excludedCount).toBe(1);
        expect(response.results.length).toBe(1);
        expect(response.results[0]?.url).toBe('https://example.com');

        expect(response.errors.length).toBe(1);
        expect(response.errors[0]?.url).toBe('http://127.0.0.1:9/internal');
        expect(response.errors[0]?.reason).toBe('ssrf_blocked');

        // Invariant verification
        expect(response.totalReturned + response.excludedCount).toBe(response.totalFound);
      } finally {
        await ctx.unroute('**/search?*');
      }
    }, 35000);

    it('enforces total character budget and marks truncated flag (Integration C)', async () => {
      const bm = BrowserManager.getInstance();
      const ctx = await bm.getContext();

      const mockSerpHtml = `
        <html>
          <body>
            <div class="g">
              <h3><a href="https://example.com"><cite>https://example.com</cite>Example Domain Budget</a></h3>
              <div class="VwiC3b">Illustrative example domain for documentation.</div>
            </div>
          </body>
        </html>
      `;

      await ctx.route('**/search?*', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'text/html',
          body: mockSerpHtml,
        });
      });

      try {
        const response = await harness.execute(deepResearchAction, {
          query: 'budget constraint test',
          limit: 1,
          maxTotalChars: 10000,
          maxCharsPerResult: 100,
        });

        expect(response.totalReturned).toBe(1);
        expect(response.results.length).toBe(1);
        const item = response.results[0];
        expect(item?.truncated).toBe(true);
        expect(item ? item.markdown.length <= 100 : false).toBe(true);
        expect(response.totalReturned + response.excludedCount).toBe(response.totalFound);
      } finally {
        await ctx.unroute('**/search?*');
      }
    }, 35000);

    it('returns empty results array when search produces 0 cards (Integration D)', async () => {
      const bm = BrowserManager.getInstance();
      const ctx = await bm.getContext();

      const mockEmptySerpHtml = `
        <html>
          <body>
            <div id="no-results">No organic cards found</div>
          </body>
        </html>
      `;

      await ctx.route('**/search?*', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'text/html',
          body: mockEmptySerpHtml,
        });
      });

      try {
        const response = await harness.execute(deepResearchAction, {
          query: 'zero results test query',
          limit: 3,
        });

        expect(response.totalFound).toBe(0);
        expect(response.totalReturned).toBe(0);
        expect(response.excludedCount).toBe(0);
        expect(response.errors).toEqual([]);
        expect(response.results).toEqual([]);
        expect(response.totalReturned + response.excludedCount).toBe(response.totalFound);
      } finally {
        await ctx.unroute('**/search?*');
      }
    }, 35000);

    it('discards malformed URL and records reason as invalid_url (Integration E)', async () => {
      const bm = BrowserManager.getInstance();
      const ctx = await bm.getContext();

      const mockSerpHtml = `
        <html>
          <body>
            <div class="g">
              <h3><a href="https://example.com"><cite>https://example.com</cite>Valid Site</a></h3>
              <div class="VwiC3b">Valid public site.</div>
            </div>
            <div class="g">
              <h3><a href="http://exa mple.com/x"><cite>http://exa mple.com/x</cite>Malformed Host</a></h3>
              <div class="VwiC3b">Malformed hostname containing a space.</div>
            </div>
          </body>
        </html>
      `;

      await ctx.route('**/search?*', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'text/html',
          body: mockSerpHtml,
        });
      });

      try {
        const response = await harness.execute(deepResearchAction, {
          query: 'malformed url rejection test',
          limit: 2,
        });

        expect(response.totalFound).toBe(2);
        expect(response.totalReturned).toBe(1);
        expect(response.excludedCount).toBe(1);
        expect(response.results.length).toBe(1);
        expect(response.results[0]?.url).toBe('https://example.com');

        expect(response.errors.length).toBe(1);
        expect(response.errors[0]?.url).toBe('http://exa mple.com/x');
        expect(response.errors[0]?.reason).toBe('invalid_url');

        // Invariant verification
        expect(response.totalReturned + response.excludedCount).toBe(response.totalFound);
      } finally {
        await ctx.unroute('**/search?*');
      }
    }, 35000);
  });
});
