import { describe, expect, it } from 'vitest';
import { resolveDefaultDisplay, resolveDefaultHeadless } from '../src/config.js';
import { getPlatformChromiumArgs } from '../src/services/browser.js';

describe('Cross-Platform Configuration & Display Resolution', () => {
  describe('resolveDefaultDisplay', () => {
    it('returns virtual display target on Linux', () => {
      const display = resolveDefaultDisplay('linux');
      expect(display).toBeDefined();
      expect(typeof display).toBe('string');
    });

    it('returns undefined on macOS (darwin) and Windows (win32)', () => {
      expect(resolveDefaultDisplay('darwin')).toBeUndefined();
      expect(resolveDefaultDisplay('win32')).toBeUndefined();
    });
  });

  describe('resolveDefaultHeadless', () => {
    it('defaults to headful false on Linux to render into Xvfb RAM framebuffer', () => {
      expect(resolveDefaultHeadless('linux', undefined)).toBe(false);
    });

    it('defaults to headless true on macOS and Windows to prevent desktop focus stealing', () => {
      expect(resolveDefaultHeadless('darwin', undefined)).toBe(true);
      expect(resolveDefaultHeadless('win32', undefined)).toBe(true);
    });

    it('honors explicit HEADLESS environment variable override across all platforms', () => {
      expect(resolveDefaultHeadless('linux', 'true')).toBe(true);
      expect(resolveDefaultHeadless('darwin', 'false')).toBe(false);
      expect(resolveDefaultHeadless('win32', 'false')).toBe(false);
    });
  });

  describe('getPlatformChromiumArgs', () => {
    it('includes SwiftShader software rasterizer flags on Linux for CPU-only servers', () => {
      const args = getPlatformChromiumArgs('linux');
      expect(args).toContain('--no-sandbox');
      expect(args).toContain('--disable-dev-shm-usage');
      expect(args).toContain('--use-gl=angle');
      expect(args).toContain('--use-angle=swiftshader');
    });

    it('omits SwiftShader on macOS and Windows to bind to native Metal/Direct3D11 compositors', () => {
      const macArgs = getPlatformChromiumArgs('darwin');
      expect(macArgs).toContain('--no-sandbox');
      expect(macArgs).toContain('--disable-dev-shm-usage');
      expect(macArgs).not.toContain('--use-angle=swiftshader');

      const winArgs = getPlatformChromiumArgs('win32');
      expect(winArgs).toContain('--no-sandbox');
      expect(winArgs).toContain('--disable-dev-shm-usage');
      expect(winArgs).not.toContain('--use-angle=swiftshader');
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
