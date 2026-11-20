import { createActionTestHarness } from '@shukoi/core/testing';
import { describe, expect, it } from 'vitest';
import { healthAction } from '../src/actions/health.js';
import { app } from '../src/entries/mcp-http.js';

describe('healthAction Real Liveness & Readiness Probe', () => {
  it('returns comprehensive subsystem health, browser metrics, and memory statistics', async () => {
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
    expect(result.browser.userDataDir).toBeDefined();

    expect(result.memory).toBeDefined();
    expect(result.memory.heapUsedMb).toBeGreaterThan(0);
    expect(result.memory.rssMb).toBeGreaterThan(0);
  });

  it('serves native REST GET /health probe matching canonical contract with 200 OK', async () => {
    const res = await app.request('/health');
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      status: string;
      timestamp: string;
      uptimeSec: number;
      browser: { userDataDir: string };
      memory: { heapUsedMb: number };
    };
    expect(['healthy', 'degraded', 'unhealthy']).toContain(body.status);
    expect(body.timestamp).toBeDefined();
    expect(body.browser).toBeDefined();
    expect(body.browser.userDataDir).toBeDefined();
    expect(body.memory).toBeDefined();
  });
});
