import { describe, expect, it } from 'vitest';
import {
  DEFAULTS,
  parseCommaSeparatedList,
  validateEnvironment,
  webResearchConfig,
} from '../src/config.js';
import { ensureVirtualDisplay, resolveDisplay } from '../src/services/browser.js';

describe('Cross-Platform Configuration & Invariants', () => {
  describe('Virtual Display Invariants & Multi-OS Architecture', () => {
    it('executes ensureVirtualDisplay idempotently without throwing', () => {
      expect(() => ensureVirtualDisplay()).not.toThrow();
    });

    it('handles non-linux platforms cleanly as a no-op', () => {
      const originalPlatform = process.platform;
      try {
        Object.defineProperty(process, 'platform', { value: 'darwin' });
        expect(() => ensureVirtualDisplay()).not.toThrow();
        expect(resolveDisplay()).toBeUndefined();
      } finally {
        Object.defineProperty(process, 'platform', { value: originalPlatform });
      }
    });

    it('resolves virtual display dynamically preserving custom/xvfb-run displays and isolating physical desktops', () => {
      const originalPlatform = process.platform;
      const originalDisplay = process.env.DISPLAY;
      try {
        Object.defineProperty(process, 'platform', { value: 'linux' });

        // Preserves custom virtual display from xvfb-run (e.g. :100)
        process.env.DISPLAY = ':100';
        expect(resolveDisplay()).toBe(':100');

        // Redirects physical desktop display :0 to :99
        process.env.DISPLAY = ':0';
        expect(resolveDisplay()).toBe(':99');

        // Redirects physical desktop display :1 to :99
        process.env.DISPLAY = ':1';
        expect(resolveDisplay()).toBe(':99');

        // Preserves virtual display :99
        process.env.DISPLAY = ':99';
        expect(resolveDisplay()).toBe(':99');

        // Defaults to :99 when unset
        delete process.env.DISPLAY;
        expect(resolveDisplay()).toBe(':99');
      } finally {
        Object.defineProperty(process, 'platform', { value: originalPlatform });
        if (originalDisplay !== undefined) {
          process.env.DISPLAY = originalDisplay;
        } else {
          delete process.env.DISPLAY;
        }
      }
    });
  });

  describe('Configurable Port & Network Invariants', () => {
    it('defaults HTTP port to 3000 when PORT is unset', () => {
      expect(webResearchConfig.port).toBe(3000);
      expect(webResearchConfig.port).toBeGreaterThanOrEqual(1);
      expect(webResearchConfig.port).toBeLessThanOrEqual(65535);
    });

    it('defaults HOST to 127.0.0.1 and defaults allowedHosts/allowedOrigins to loopback per D4', () => {
      expect(webResearchConfig.host).toBe('127.0.0.1');
      expect(webResearchConfig.allowedHosts).toContain('localhost');
      expect(webResearchConfig.allowedOrigins).toContain('localhost');
      expect(Array.isArray(webResearchConfig.apiKeys)).toBe(true);

      // parseCommaSeparatedList helper tests
      expect(parseCommaSeparatedList(undefined, ['default'])).toEqual(['default']);
      expect(parseCommaSeparatedList('', ['default'])).toEqual(['default']);
      expect(parseCommaSeparatedList('   ', ['default'])).toEqual(['default']);
      expect(parseCommaSeparatedList('host1, host2,host3')).toEqual(['host1', 'host2', 'host3']);
      expect(parseCommaSeparatedList('*')).toEqual(['*']);
    });
  });

  describe('webResearchConfig Universal Defaults', () => {
    it('populates valid universal defaults for network, scroll, and thresholds', () => {
      expect(webResearchConfig.networkIdleTimeoutMs).toBeGreaterThanOrEqual(1000);
      expect(webResearchConfig.scrollDelayMs).toBeGreaterThanOrEqual(100);
      expect(webResearchConfig.scrollStepPx).toBeGreaterThanOrEqual(200);
      expect(webResearchConfig.scrollSettleTimeoutMs).toBeGreaterThanOrEqual(100);
      expect(webResearchConfig.maxScrollSteps).toBeGreaterThanOrEqual(0);
      expect(webResearchConfig.searchWaitTimeoutMs).toBeGreaterThanOrEqual(1000);
      expect(webResearchConfig.readabilityCharThreshold).toBeGreaterThanOrEqual(5);
      expect(webResearchConfig.requestBudgetMs).toBe(DEFAULTS.REQUEST_BUDGET_MS);
      expect(webResearchConfig.deepResearchBudgetMs).toBe(DEFAULTS.DEEP_RESEARCH_BUDGET_MS);
      expect(webResearchConfig.pageTimeoutMs).toBe(DEFAULTS.PAGE_TIMEOUT_MS);
      expect(webResearchConfig.minPageBudgetMs).toBe(DEFAULTS.MIN_PAGE_BUDGET_MS);
      expect(webResearchConfig.stabilizeTimeoutMs).toBe(DEFAULTS.STABILIZE_TIMEOUT_MS);
      expect(webResearchConfig.settlePollMs).toBe(DEFAULTS.SETTLE_POLL_MS);
      expect(webResearchConfig.maxRedirects).toBe(DEFAULTS.MAX_REDIRECTS);
      expect(webResearchConfig.maxMarkdownChars).toBe(DEFAULTS.MAX_MARKDOWN_CHARS);
      expect(webResearchConfig.maxQueueLength).toBe(DEFAULTS.MAX_QUEUE_LENGTH);
      expect(webResearchConfig.maxResultsPerHost).toBe(DEFAULTS.MAX_RESULTS_PER_HOST);
    });
  });

  describe('Fail-Fast Validation & Bind Safety (FR-10, FR-11, EC-19, EC-20)', () => {
    it('validates environment successfully with nominal defaults', () => {
      const config = validateEnvironment({
        HOST: '127.0.0.1',
        PORT: '3000',
      });
      expect(config.host).toBe('127.0.0.1');
      expect(config.port).toBe(3000);
    });

    it('rejects invalid PORT with exit 1 (EC-19)', () => {
      let exitCode: number | undefined;
      let stderrMsg = '';
      const originalExit = process.exit;
      const originalStderr = process.stderr.write;

      try {
        process.exit = ((code?: number) => {
          exitCode = code;
          throw new Error(`EXIT_${code}`);
        }) as unknown as typeof process.exit;

        process.stderr.write = ((chunk: unknown) => {
          stderrMsg += String(chunk);
          return true;
        }) as unknown as typeof process.stderr.write;

        expect(() =>
          validateEnvironment({
            PORT: 'abc',
          }),
        ).toThrow('EXIT_1');

        expect(exitCode).toBe(1);
        expect(stderrMsg).toContain('PORT');
      } finally {
        process.exit = originalExit;
        process.stderr.write = originalStderr;
      }
    });

    it('rejects invalid MAX_CONCURRENT_PAGES with exit 1 (VC-07)', () => {
      let exitCode: number | undefined;
      let stderrMsg = '';
      const originalExit = process.exit;
      const originalStderr = process.stderr.write;

      try {
        process.exit = ((code?: number) => {
          exitCode = code;
          throw new Error(`EXIT_${code}`);
        }) as unknown as typeof process.exit;

        process.stderr.write = ((chunk: unknown) => {
          stderrMsg += String(chunk);
          return true;
        }) as unknown as typeof process.stderr.write;

        expect(() =>
          validateEnvironment({
            MAX_CONCURRENT_PAGES: 'abc',
          }),
        ).toThrow('EXIT_1');

        expect(exitCode).toBe(1);
        expect(stderrMsg).toContain('MAX_CONCURRENT_PAGES');
      } finally {
        process.exit = originalExit;
        process.stderr.write = originalStderr;
      }
    });

    it('rejects non-loopback HOST without MCP_API_KEY with exit 1 (EC-20)', () => {
      let exitCode: number | undefined;
      let stderrMsg = '';
      const originalExit = process.exit;
      const originalStderr = process.stderr.write;

      try {
        process.exit = ((code?: number) => {
          exitCode = code;
          throw new Error(`EXIT_${code}`);
        }) as unknown as typeof process.exit;

        process.stderr.write = ((chunk: unknown) => {
          stderrMsg += String(chunk);
          return true;
        }) as unknown as typeof process.stderr.write;

        expect(() =>
          validateEnvironment({
            HOST: '0.0.0.0',
            MCP_API_KEY: undefined,
          }),
        ).toThrow('EXIT_1');

        expect(exitCode).toBe(1);
        expect(stderrMsg).toContain('MCP_API_KEY');
      } finally {
        process.exit = originalExit;
        process.stderr.write = originalStderr;
      }
    });

    it('rejects empty MCP_API_KEY="" with exit 1', () => {
      let exitCode: number | undefined;
      let stderrMsg = '';
      const originalExit = process.exit;
      const originalStderr = process.stderr.write;

      try {
        process.exit = ((code?: number) => {
          exitCode = code;
          throw new Error(`EXIT_${code}`);
        }) as unknown as typeof process.exit;

        process.stderr.write = ((chunk: unknown) => {
          stderrMsg += String(chunk);
          return true;
        }) as unknown as typeof process.stderr.write;

        expect(() =>
          validateEnvironment({
            HOST: '127.0.0.1',
            MCP_API_KEY: '',
          }),
        ).toThrow('EXIT_1');

        expect(exitCode).toBe(1);
        expect(stderrMsg).toContain('MCP_API_KEY');
      } finally {
        process.exit = originalExit;
        process.stderr.write = originalStderr;
      }
    });

    it('permits non-loopback HOST when non-empty MCP_API_KEY is supplied', () => {
      const config = validateEnvironment({
        HOST: '0.0.0.0',
        MCP_API_KEY: 'secret-key-123',
      });
      expect(config.host).toBe('0.0.0.0');
      expect(config.apiKeys).toContain('secret-key-123');
    });
  });
});
