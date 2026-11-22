import { createActionTestHarness } from '@shukoi/core/testing';
import { describe, expect, it } from 'vitest';
import { healthAction } from '../src/actions/health.js';
import { app } from '../src/entries/mcp-http.js';
import { BrowserManager } from '../src/services/browser.js';

describe('healthAction Real Liveness & Readiness Probe', () => {
  it('returns comprehensive subsystem health, browser metrics, and memory statistics without leaking userDataDir', async () => {
    const harness = createActionTestHarness();
    const result = await harness.execute(healthAction, {});

    expect(['healthy', 'degraded', 'unhealthy']).toContain(result.status);
    expect(result.timestamp).toBeDefined();
    expect(result.uptimeSec).toBeGreaterThanOrEqual(0);

    expect(result.browser).toBeDefined();
    expect(typeof result.browser.connected).toBe('boolean');
    expect(typeof result.browser.prewarmed).toBe('boolean');
    expect(typeof result.browser.activeTabs).toBe('number');
    expect(result.browser.maxCapacity).toBeGreaterThan(0);
    expect(typeof result.browser.requestCount).toBe('number');

    // FR-12: userDataDir is removed to prevent information leakage
    expect((result.browser as Record<string, unknown>).userDataDir).toBeUndefined();

    expect(result.memory).toBeDefined();
    expect(result.memory.heapUsedMb).toBeGreaterThan(0);
    expect(result.memory.rssMb).toBeGreaterThan(0);
  });

  it('serves native REST GET /health probe matching canonical contract with 200 or 503 according to liveness', async () => {
    const res = await app.request('/health');
    const body = (await res.json()) as {
      status: string;
      timestamp: string;
      uptimeSec: number;
      browser: Record<string, unknown>;
      memory: { heapUsedMb: number };
    };

    if (body.status === 'healthy') {
      expect(res.status).toBe(200);
    } else {
      expect(res.status).toBe(503);
    }

    expect(['healthy', 'degraded', 'unhealthy']).toContain(body.status);
    expect(body.timestamp).toBeDefined();
    expect(body.browser).toBeDefined();
    // FR-12: userDataDir removed from HTTP response
    expect(body.browser.userDataDir).toBeUndefined();
    expect(body.memory).toBeDefined();
  });

  it('returns HTTP 503 when browser context is degraded or closed (FR-12, EC-17)', async () => {
    const bm = BrowserManager.getInstance();
    await bm.closeAll();

    const res = await app.request('/health');
    expect(res.status).toBe(503);

    const body = (await res.json()) as { status: string; browser: { connected: boolean } };
    expect(body.status).toBe('degraded');
    expect(body.browser.connected).toBe(false);
  });
});
