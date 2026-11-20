/**
 * @purpose Standalone Streamable HTTP transport entrypoint for MCP agents and containerized deployments.
 * @rationale Exposes `/mcp` Streamable HTTP protocol endpoint and `/health` probe over HTTP with graceful connection draining, DNS-rebinding protection, and per-request lifecycle isolation.
 * @preconditions Port and host network permissions available.
 * @invariants Stateless per-request execution; thread-safe Hono routing; clean SIGTERM/SIGINT process lifecycle handling.
 */

import { compileMcpCatalog, createMcpHttpHandler } from '@shukoi/mcp/http';
import { createSelfHostServer } from '@shukoi/selfhost';
import { Hono } from 'hono';
import { googleSearchAction } from '../actions/google-search.js';
import { healthAction } from '../actions/health.js';
import { webExtractAction } from '../actions/web-extract.js';
import { config, webResearchConfig } from '../config.js';
import { BrowserManager } from '../services/browser.js';

/**
 * @purpose Hono application instance routing HTTP requests.
 * @rationale Provides ultra-fast Web-Standard routing for health checks and MCP transport.
 * @invariants Initialized Hono app.
 */
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
 * @purpose Running Streamable HTTP server instance.
 * @rationale Serves Streamable HTTP MCP traffic with graceful connection draining and lifecycle traps.
 * @invariants Initialized server instance.
 */
export const server = createSelfHostServer(app, config, {
  port: webResearchConfig.port,
  host: process.env.HOST || '0.0.0.0',
});

// Asynchronously warm-start the persistent browser pool at server boot
BrowserManager.getInstance()
  .warmup()
  .catch(() => {});
