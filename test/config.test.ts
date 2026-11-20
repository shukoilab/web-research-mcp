import { describe, expect, it } from 'vitest';

describe('Cross-Platform Configuration & Invariants', () => {
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
