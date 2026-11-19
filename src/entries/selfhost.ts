/**
 * @purpose Self-hosted HTTP server entrypoint exposing Streamable HTTP MCP and REST endpoints.
 * @rationale Provides network-accessible MCP endpoint on /mcp with DNS-rebinding protection and per-request lifecycle isolation.
 * @preconditions Port and host network permissions available.
 * @invariants Stateless per-request execution; thread-safe Hono routing.
 */

import { compileMcpCatalog, createMcpHttpHandler } from '@shukoi/mcp/http';
import { createSelfHostServer } from '@shukoi/selfhost';
import { Hono } from 'hono';
import { googleSearchAction } from '../actions/google-search.js';
import { healthAction } from '../actions/health.js';
import { webExtractAction } from '../actions/web-extract.js';
import { config } from '../config.js';
import { BrowserManager } from '../services/browser.js';

export const app = new Hono();

/**
 * @purpose Pre-compiled MCP catalog containing all active actions.
 * @rationale Compiled once at boot to eliminate per-request AST building overhead.
 * @invariants Deeply frozen McpCatalog instance.
 */
export const catalog = compileMcpCatalog([healthAction, googleSearchAction, webExtractAction]);

// Dedicated REST endpoint for Kubernetes, Docker, and external liveness/readiness probes
app.get('/health', (c) => {
  const metrics = BrowserManager.getInstance().getHealthMetrics();
  const statusCode = metrics.status === 'unhealthy' ? 503 : 200;
  return c.json(
    {
      status: metrics.status,
      timestamp: new Date().toISOString(),
      uptimeSec: metrics.uptimeSec,
      browser: {
        connected: metrics.connected,
        prewarmed: metrics.prewarmed,
        activeTabs: metrics.activeTabs,
        maxCapacity: metrics.maxCapacity,
        requestCount: metrics.requestCount,
        userDataDir: metrics.userDataDir,
      },
      display: metrics.display,
      memory: {
        heapUsedMb: metrics.memory.heapUsedMb,
        rssMb: metrics.memory.rssMb,
      },
    },
    statusCode,
  );
});

const handler = createMcpHttpHandler(catalog, config);

app.all('/mcp', async (c) => handler(c.req.raw, c.env));

/**
 * @purpose Running self-hosted HTTP server instance.
 * @rationale Serves Streamable HTTP MCP traffic with graceful shutdown support.
 * @invariants Initialized server instance.
 */
export const server = createSelfHostServer(app, config);

// Asynchronously warm-start the persistent browser pool at server boot
BrowserManager.getInstance()
  .warmup()
  .catch(() => {});
