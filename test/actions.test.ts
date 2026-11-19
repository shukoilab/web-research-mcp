import { DomainError } from '@shukoi/core';
import { createActionTestHarness } from '@shukoi/core/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { googleSearchAction } from '../src/actions/google-search.js';
import { healthAction } from '../src/actions/health.js';
import { webExtractAction } from '../src/actions/web-extract.js';
import { BrowserManager } from '../src/services/browser.js';

describe('Shukoi Action Tri-Transport Parity & Contracts', () => {
  const harness = createActionTestHarness();

  beforeAll(async () => {
    await BrowserManager.getInstance().warmup();
  });

  afterAll(async () => {
    await BrowserManager.getInstance().closeAll();
  });

  describe('healthAction', () => {
    it('executes health probe and returns valid contract', async () => {
      const result = await harness.execute(healthAction, {});
      expect(['healthy', 'degraded']).toContain(result.status);
      expect(result.timestamp).toBeDefined();
    });
  });

  describe('googleSearchAction', () => {
    it('throws VALIDATION_ERROR when query is missing or empty', async () => {
      await expect(harness.execute(googleSearchAction, { query: '' })).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
      });

      await expect(harness.execute(googleSearchAction, {})).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
      });
    });

    it('rejects additional unexpected properties on input', async () => {
      await expect(
        harness.execute(googleSearchAction, {
          query: 'valid query',
          unexpectedField: true,
        }),
      ).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
      });
    });

    it('handles AbortSignal cancellation cleanly', async () => {
      const abortController = new AbortController();
      abortController.abort();

      await expect(
        harness.execute(
          googleSearchAction,
          { query: 'abort test query' },
          { signal: abortController.signal },
        ),
      ).rejects.toThrowError(DomainError);
    });

    it('executes google search and returns structured results array', async () => {
      const result = await harness.execute(googleSearchAction, {
        query: 'open source AI',
        limit: 5,
      });
      expect(result.query).toBe('open source AI');
      expect(Array.isArray(result.results)).toBe(true);
      expect(result.totalReturned).toBeGreaterThanOrEqual(1);
      expect(result.results[0]?.title).toBeDefined();
      expect(result.results[0]?.url).toBeDefined();
    }, 25000);
  });

  describe('webExtractAction', () => {
    it('throws BAD_REQUEST when target URL violates SSRF private IP rules', async () => {
      await expect(
        harness.execute(webExtractAction, {
          url: 'http://127.0.0.1:8080/admin',
        }),
      ).rejects.toMatchObject({
        code: 'BAD_REQUEST',
      });

      await expect(
        harness.execute(webExtractAction, {
          url: 'http://localhost:3000',
        }),
      ).rejects.toMatchObject({
        code: 'BAD_REQUEST',
      });

      await expect(
        harness.execute(webExtractAction, {
          url: 'http://169.254.169.254/latest/meta-data',
        }),
      ).rejects.toMatchObject({
        code: 'BAD_REQUEST',
      });
    });

    it('throws VALIDATION_ERROR when url format is invalid', async () => {
      await expect(
        harness.execute(webExtractAction, {
          url: 'not-a-valid-uri',
        }),
      ).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
      });
    });

    it('rejects additional unexpected properties on input', async () => {
      await expect(
        harness.execute(webExtractAction, {
          url: 'https://example.com',
          unknownProperty: 123,
        }),
      ).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
      });
    });

    it('rejects removed bloat properties like includeRawHtml and waitForSelector', async () => {
      await expect(
        harness.execute(webExtractAction, {
          url: 'https://example.com',
          includeRawHtml: true,
        }),
      ).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
      });

      await expect(
        harness.execute(webExtractAction, {
          url: 'https://example.com',
          waitForSelector: 'h1',
        }),
      ).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
      });
    });

    it('rejects out-of-range scrollDelayMs and maxScrolls with VALIDATION_ERROR', async () => {
      await expect(
        harness.execute(webExtractAction, {
          url: 'https://example.com',
          scrollDelayMs: 50, // below min 100
        }),
      ).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
      });

      await expect(
        harness.execute(webExtractAction, {
          url: 'https://example.com',
          maxScrolls: 25, // above max 20
        }),
      ).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
      });
    });

    it('handles AbortSignal cancellation cleanly', async () => {
      const abortController = new AbortController();
      abortController.abort();

      await expect(
        harness.execute(
          webExtractAction,
          { url: 'https://example.com' },
          { signal: abortController.signal },
        ),
      ).rejects.toThrowError(DomainError);
    });

    it('executes web extraction on a valid URL and returns structured Markdown', async () => {
      const result = await harness.execute(webExtractAction, {
        url: 'https://example.com',
      });
      expect(result.url).toBe('https://example.com');
      expect(result.title).toContain('Example Domain');
      expect(result.markdown).toContain('documentation examples');
    }, 25000);
  });
});
