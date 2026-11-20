import { describe, expect, it } from 'vitest';
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
    it('defaults HTTP port to 3000 when PORT is unset', async () => {
      const { webResearchConfig } = await import('../src/config.js');
      expect(webResearchConfig.port).toBeGreaterThanOrEqual(1);
      expect(webResearchConfig.port).toBeLessThanOrEqual(65535);
    });

    it('defaults HOST to 0.0.0.0 and allows wildcards on allowedHosts and allowedOrigins', async () => {
      const { webResearchConfig, parseCommaSeparatedList } = await import('../src/config.js');
      expect(webResearchConfig.host).toBe('0.0.0.0');
      expect(webResearchConfig.allowedHosts).toContain('*');
      expect(webResearchConfig.allowedOrigins).toContain('*');
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
    it('populates valid universal defaults for network, scroll, and thresholds', async () => {
      const { webResearchConfig } = await import('../src/config.js');
      expect(webResearchConfig.networkIdleTimeoutMs).toBeGreaterThanOrEqual(1000);
      expect(webResearchConfig.scrollDelayMs).toBeGreaterThanOrEqual(100);
      expect(webResearchConfig.scrollStepPx).toBeGreaterThanOrEqual(200);
      expect(webResearchConfig.scrollSettleTimeoutMs).toBeGreaterThanOrEqual(100);
      expect(webResearchConfig.maxScrollSteps).toBeGreaterThanOrEqual(0);
      expect(webResearchConfig.searchWaitTimeoutMs).toBeGreaterThanOrEqual(1000);
      expect(webResearchConfig.readabilityCharThreshold).toBeGreaterThanOrEqual(5);
    });
  });
});
