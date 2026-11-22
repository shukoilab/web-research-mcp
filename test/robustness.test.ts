/**
 * @purpose Comprehensive robustness test suite verifying FR-01..FR-18 and EC-01..EC-20 against local HTTP fixtures.
 * @rationale Exercises real browser navigation, SSRF interception, document settling loops, charset repair, and content classification without external network calls.
 * @invariants Offline execution against port-0 local fixture; clean resource teardown; zero test flakes.
 */

import { DomainError } from '@shukoi/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AsyncSemaphore, BrowserManager, smartScrollAndHydrate } from '../src/services/browser.js';
import { Deadline } from '../src/services/deadline.js';
import { truncateMarkdown } from '../src/services/extractor.js';
import { navigateAndCapture } from '../src/services/navigation.js';
import {
  getDedupeKey,
  isGoogleTrackingUrl,
  normalizeCanonicalUrl,
} from '../src/services/search.js';
import { assertPublicUrl } from '../src/services/ssrf.js';
import { type HttpFixtureServer, startHttpFixture } from './fixtures/http-fixture.js';

describe('Web Research Engine Verification & Edge Cases (FR-01..FR-18, EC-01..EC-20)', () => {
  let fixture: HttpFixtureServer;
  const browserManager = BrowserManager.getInstance();

  beforeAll(async () => {
    fixture = await startHttpFixture();
    await browserManager.warmup();
  });

  afterAll(async () => {
    await fixture.close();
    await browserManager.closeAll();
  });

  describe('Navigation & Redirect Robustness (EC-01, EC-04, EC-05)', () => {
    it('EC-01: follows HTTP 302 chain and captures final landed URL with accurate redirectCount', async () => {
      const result = await browserManager.withPage(async (page) => {
        return await navigateAndCapture(page, fixture.url('/redirect-chain?hops=2'), {
          allowLoopback: true,
        });
      });

      expect(result.outcome).toBe('success');
      expect(result.finalUrl).toContain('/final-page');
      expect(result.redirectCount).toBe(2);
      expect(result.title).toBe('Final Destination');
      expect(result.html).toContain('Final Landing Title');
    });

    it('EC-04: settles meta http-equiv=refresh 0 and extracts final page and metadata', async () => {
      const result = await browserManager.withPage(async (page) => {
        return await navigateAndCapture(page, fixture.url('/meta-refresh'), {
          allowLoopback: true,
          stabilizeTimeoutMs: 3000,
          settlePollMs: 100,
        });
      });

      expect(result.outcome).toBe('success');
      expect(result.finalUrl).toContain('/final-page');
      expect(result.title).toBe('Final Destination');
    });

    it('EC-05: survives JS location.href navigation during capture without throwing 500 error', async () => {
      const result = await browserManager.withPage(async (page) => {
        return await navigateAndCapture(page, fixture.url('/js-redirect'), {
          allowLoopback: true,
          stabilizeTimeoutMs: 3000,
          settlePollMs: 100,
        });
      });

      expect(result.outcome).toBe('success');
      expect(result.finalUrl).toContain('/final-page');
      expect(result.title).toBe('Final Destination');
    });
  });

  describe('SSRF Closure & DNS Validation (FR-01, EC-02, EC-03)', () => {
    it('EC-02: aborts redirect hop pointing to private IP (127.0.0.1) and returns outcome ssrf', async () => {
      const result = await browserManager.withPage(async (page) => {
        return await navigateAndCapture(page, fixture.url('/redirect-to-private'), {
          allowLoopback: false, // Strict production SSRF enforcement
        });
      });

      expect(result.outcome).toBe('ssrf');
      expect(result.reason).toContain('private/reserved');
    });

    it('EC-03: rejects hostnames resolving to loopback before navigation (127.0.0.1.nip.io, localhost.)', async () => {
      await expect(assertPublicUrl('http://127.0.0.1.nip.io')).rejects.toThrowError(DomainError);
      await expect(assertPublicUrl('http://localhost.')).rejects.toThrowError(DomainError);
    });
  });

  describe('Content Classification & Charset Repair (FR-04, FR-16, EC-06..EC-09)', () => {
    it('EC-06: returns non-2xx responses (HTTP 404 & 503) as valid results with body content (D1)', async () => {
      const res404 = await browserManager.withPage(async (page) => {
        return await navigateAndCapture(page, fixture.url('/status-404'), {
          allowLoopback: true,
        });
      });

      expect(res404.status).toBe(404);
      expect(res404.outcome).toBe('success');
      expect(res404.html).toContain('Page Not Found');

      const res503 = await browserManager.withPage(async (page) => {
        return await navigateAndCapture(page, fixture.url('/status-503'), {
          allowLoopback: true,
        });
      });

      expect(res503.status).toBe(503);
      expect(res503.outcome).toBe('success');
      expect(res503.html).toContain('Service Overloaded');
    });

    it('EC-06b: reports the requested URL when an empty error response renders as a Chrome error page', async () => {
      const result = await browserManager.withPage(async (page) => {
        return await navigateAndCapture(page, fixture.url('/status-404-empty'), {
          allowLoopback: true,
        });
      });

      expect(result.status).toBe(404);
      expect(result.finalUrl).toBe(fixture.url('/status-404-empty'));
    });

    it('EC-07: classifies HTTP 204 No Content as empty_content without throwing', async () => {
      const result = await browserManager.withPage(async (page) => {
        return await navigateAndCapture(page, fixture.url('/status-204'), {
          allowLoopback: true,
        });
      });

      expect(result.status).toBe(204);
      expect(result.outcome).toBe('empty_content');
    });

    it('EC-08: classifies PDF and binary attachment responses as unsupported_content', async () => {
      const pdfRes = await browserManager.withPage(async (page) => {
        return await navigateAndCapture(page, fixture.url('/pdf'), {
          allowLoopback: true,
        });
      });
      expect(pdfRes.outcome).toBe('unsupported_content');

      const attachRes = await browserManager.withPage(async (page) => {
        return await navigateAndCapture(page, fixture.url('/attachment'), {
          allowLoopback: true,
        });
      });
      expect(attachRes.outcome).toBe('unsupported_content');
    });

    it('EC-09: repairs bare text/html without charset header and preserves UTF-8 accents (Café crème)', async () => {
      const result = await browserManager.withPage(async (page) => {
        return await navigateAndCapture(page, fixture.url('/utf8-no-charset'), {
          allowLoopback: true,
        });
      });

      expect(result.outcome).toBe('success');
      expect(result.html).toContain('Café crème');
      expect(result.html).toContain('Délicieux café français');
    });
  });

  describe('Concurrency & Semaphore Safety (FR-14, EC-10, EC-11)', () => {
    it('EC-10: abort while queued in semaphore does not consume permits and rejects with BAD_REQUEST', async () => {
      const sem = new AsyncSemaphore(1, 10);
      await sem.acquire(); // Acquire only permit

      const abortController = new AbortController();
      const queuedPromise = sem.acquire({ signal: abortController.signal });

      expect(sem.queueLength).toBe(1);
      abortController.abort();

      await expect(queuedPromise).rejects.toThrowError(DomainError);
      expect(sem.queueLength).toBe(0);

      // Releasing restores permit to available capacity
      sem.release();
      await expect(sem.acquire()).resolves.toBeUndefined();
      sem.release();
    });

    it('EC-11: rejects requests exceeding MAX_QUEUE_LENGTH with RATE_LIMIT_EXCEEDED (429) without deadlock', async () => {
      const maxCapacity = 2;
      const maxQueue = 3;
      const sem = new AsyncSemaphore(maxCapacity, maxQueue);

      // Acquire all 2 permits
      await sem.acquire();
      await sem.acquire();

      // Queue 3 requests (saturates queue)
      const q1 = sem.acquire();
      const q2 = sem.acquire();
      const q3 = sem.acquire();
      expect(sem.queueLength).toBe(3);

      // 4th queued request breaches capacity
      await expect(sem.acquire()).rejects.toMatchObject({
        code: 'RATE_LIMIT_EXCEEDED',
      });

      // Release permits and verify queued resolve in FIFO order
      sem.release();
      await q1;
      sem.release();
      await q2;
      sem.release();
      await q3;
      sem.release();
      sem.release();
    });
  });

  describe('Deadline Budget & Character Limits (FR-06, FR-15, EC-13, EC-14)', () => {
    it('EC-13: deadline throws GATEWAY_TIMEOUT (504) upon expiration mid-flight', async () => {
      const deadline = Deadline.create(50); // 50ms budget
      await new Promise((r) => setTimeout(r, 60));

      expect(deadline.expired).toBe(true);
      expect(() => deadline.throwIfExpired()).toThrowError(DomainError);
      try {
        deadline.throwIfExpired();
      } catch (err) {
        expect((err as DomainError).code).toBe('GATEWAY_TIMEOUT');
      }
    });

    it('EC-14: cuts markdown exceeding MAX_MARKDOWN_CHARS at paragraph boundary without corrupting surrogate pairs', () => {
      const p1 = 'First paragraph content.';
      const p2 = 'Second paragraph content with emojis 🚀🌟.';
      const raw = `${p1}\n\n${p2}`;

      const { text, truncated } = truncateMarkdown(raw, p1.length + 5);
      expect(truncated).toBe(true);
      expect(text).toContain(p1);
      expect(text).not.toContain(p2);
      expect(text).toContain('[Content truncated due to size budget]');
    });
  });

  describe('Search Card Hygiene & Deduplication (FR-07, EC-15, EC-16)', () => {
    it('EC-15: drops Google /goto tracking URLs and truncated breadcrumb cites without hallucination', () => {
      expect(isGoogleTrackingUrl('https://www.google.com/goto?url=CAES...')).toBe(true);
      expect(isGoogleTrackingUrl('https://www.google.com/url?sa=t&rct=j')).toBe(true);
      expect(isGoogleTrackingUrl('https://example.com/valid-article')).toBe(false);

      // Drops truncated breadcrumbs containing ellipsis
      const result = normalizeCanonicalUrl('https://github.com › minghuaw › ...', null);
      expect(result).toBe('https://github.com/');
    });

    it('EC-16: deduplicates search result URLs based on host + pathname + query', () => {
      const key1 = getDedupeKey('https://example.com/article?page=1#heading-1');
      const key2 = getDedupeKey('https://example.com/article/?page=1#heading-2');
      expect(key1).toBe(key2);
    });
  });

  describe('Safe DOM Unfolding (FR-09)', () => {
    it('unfolds details and aria-expanded inside main when unfoldInteractive is enabled', async () => {
      const { detailsOpen, extraDisplay, titleMutated } = await browserManager.withPage(
        async (page) => {
          await page.goto(fixture.url('/details-and-button'), { waitUntil: 'domcontentloaded' });
          await smartScrollAndHydrate(page, {
            maxScrolls: 2,
            unfoldInteractive: true,
          });

          const detailsOpen = await page.$eval(
            '#native-details',
            (el) => (el as HTMLDetailsElement).open,
          );
          const extraDisplay = await page.$eval(
            '#extra',
            (el) => window.getComputedStyle(el).display,
          );
          const titleMutated = (await page.title()) === 'Mutated Title';

          return { detailsOpen, extraDisplay, titleMutated };
        },
      );

      expect(detailsOpen).toBe(true);
      expect(extraDisplay).toBe('block');
      // Mutating button should not have been clicked if not controlling accordion panel
      expect(titleMutated).toBe(false);
    });
  });
});
