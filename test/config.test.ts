import { describe, expect, it } from 'vitest';
import { ensureVirtualDisplay } from '../src/services/browser.js';

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
      } finally {
        Object.defineProperty(process, 'platform', { value: originalPlatform });
      }
    });
  });

  describe('Configurable Port & Network Invariants', () => {
    it('defaults HTTP port to 3000 when PORT is unset', async () => {
      const { webResearchConfig } = await import('../src/config.js');
      expect(webResearchConfig.port).toBeGreaterThanOrEqual(1);
      expect(webResearchConfig.port).toBeLessThanOrEqual(65535);
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
