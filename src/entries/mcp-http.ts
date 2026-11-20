/**
 * @purpose Standalone Streamable HTTP transport entrypoint for MCP agents and containerized deployments.
 * @rationale Exposes `/mcp` Streamable HTTP protocol endpoint and `/health` probe over HTTP with graceful connection draining, DNS-rebinding protection, and per-request lifecycle isolation.
 * @preconditions Port and host network permissions available.
 * @invariants Stateless per-request execution; thread-safe Hono routing; clean SIGTERM/SIGINT process lifecycle handling.
 */

import { serve } from '@hono/node-server';
import { compileMcpCatalog, createMcpHttpHandler } from '@shukoi/mcp/http';
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
 * @purpose Running Streamable HTTP server instance managed by @hono/node-server.
 * @rationale Serves Streamable HTTP MCP traffic with native HTTP streaming and graceful lifecycle management.
 * @invariants Initialized ServerType instance.
 */
export const server = serve({
  fetch: app.fetch,
  port: webResearchConfig.port,
  hostname: process.env.HOST || '0.0.0.0',
});

let isShuttingDown = false;

/**
 * @purpose Coordinates deterministic graceful shutdown upon receiving termination signals.
 * @rationale Drains active HTTP connections, flushes browser contexts, and prevents orphan processes on container or process stop.
 * @preconditions Server is initialized and listening on configured port.
 * @param _signal Termination signal string ('SIGTERM' | 'SIGINT').
 * @returns Void.
 * @throws Never throws unhandled; errors during shutdown are suppressed before process exit.
 * @invariants Idempotent shutdown guard; unref'd 10s fallback timer; closes idle connections and terminates cleanly with exit code 0.
 */
function handleShutdown(_signal: string): void {
  if (isShuttingDown) return;
  isShuttingDown = true;

  const forceTimer = setTimeout(() => {
    process.exit(1);
  }, 10000);
  forceTimer.unref();

  (server as unknown as { closeIdleConnections?: () => void }).closeIdleConnections?.();
  server.close(async () => {
    try {
      await BrowserManager.getInstance().closeAll();
    } finally {
      clearTimeout(forceTimer);
      process.exit(0);
    }
  });
}

process.on('SIGTERM', () => handleShutdown('SIGTERM'));
process.on('SIGINT', () => handleShutdown('SIGINT'));

// Asynchronously warm-start the persistent browser pool at server boot
BrowserManager.getInstance()
  .warmup()
  .catch(() => {});
