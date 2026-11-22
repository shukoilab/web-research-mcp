/**
 * @purpose Standalone Streamable HTTP transport entrypoint for MCP agents and containerized deployments.
 * @rationale Exposes `/mcp` Streamable HTTP protocol endpoint and read-only `/health` probe over HTTP with graceful connection draining, DNS-rebinding protection, bind safety validation, and single-path shutdown coordination.
 * @preconditions Port and host network permissions available.
 * @invariants Stateless per-request execution; thread-safe Hono routing; clean SIGTERM/SIGINT process lifecycle handling.
 */

import { type ServerType, serve } from '@hono/node-server';
import { compileMcpCatalog, createMcpHttpHandler } from '@shukoi/mcp/http';
import { Hono } from 'hono';
import { deepResearchAction } from '../actions/deep-research.js';
import { googleSearchAction } from '../actions/google-search.js';
import { healthAction } from '../actions/health.js';
import { webExtractAction } from '../actions/web-extract.js';
import { config, webResearchConfig } from '../config.js';
import { apiKeyAuthMiddleware } from '../services/auth.js';
import { BrowserManager } from '../services/browser.js';

/**
 * @purpose Pre-compiled MCP catalog containing all active actions.
 * @rationale Compiled once at boot to eliminate per-request AST building overhead.
 * @invariants Deeply frozen McpCatalog instance.
 */
export const catalog = compileMcpCatalog([
  healthAction,
  googleSearchAction,
  webExtractAction,
  deepResearchAction,
]);

/**
 * @purpose Factory function constructing the configured Hono application.
 * @rationale Decouples HTTP application routing and middleware definition from network socket binding, enabling pure unit testing.
 * @preconditions Actions catalog and runtime config are initialized.
 * @param None.
 * @returns Instantiated and routed Hono application.
 * @throws Never throws directly.
 * @invariants Pure application factory; idempotent routes.
 */
export function createApp(): Hono {
  const application = new Hono();

  // Dedicated REST endpoint for Kubernetes, Docker, and external liveness/readiness probes (FR-12)
  application.get('/health', (c) => {
    const metrics = BrowserManager.getInstance().getHealthMetrics();
    // HTTP 503 if status is degraded or unhealthy
    const statusCode = metrics.status === 'healthy' ? 200 : 503;
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
          queuedRequests: metrics.queuedRequests,
          requestCount: metrics.requestCount,
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

  application.use('/mcp', apiKeyAuthMiddleware({ apiKeys: webResearchConfig.apiKeys }));
  application.all('/mcp', async (c) => handler(c.req.raw, c.env));

  return application;
}

/**
 * @purpose Exported Hono application instance.
 * @rationale Provides backwards compatibility for existing imports and test suites.
 * @invariants Initialized Hono application.
 */
export const app: Hono = createApp();

/**
 * @purpose Lifecycle manager coordinating graceful server shutdown and resource draining.
 * @rationale Enforces a single signal path: stop ingress, close idle sockets, terminate browser tabs, and exit within 10 seconds.
 * @invariants Idempotent shutdown; zero zombie processes.
 */
export class ShutdownCoordinator {
  private isShuttingDown = false;
  private readonly timeoutMs: number;

  /**
   * @purpose Constructs a new ShutdownCoordinator instance.
   * @rationale Configures maximum drain timeout before force termination.
   * @preconditions timeoutMs must be a positive integer.
   * @param timeoutMs Maximum drain duration in milliseconds (default 10000ms).
   * @returns Instantiated ShutdownCoordinator.
   * @throws Never throws.
   * @invariants Immutable timeout configuration.
   */
  constructor(timeoutMs = 10000) {
    this.timeoutMs = timeoutMs;
  }

  /**
   * @purpose Executes graceful termination sequence upon receiving OS termination signals.
   * @rationale Drains HTTP server connections, terminates active browser contexts, and exits with code 0.
   * @preconditions Server handle and BrowserManager must be operational.
   * @param _signal Process signal received ('SIGTERM' | 'SIGINT').
   * @param server Optional running ServerType instance to close.
   * @returns Promise resolving once shutdown concludes.
   * @throws Never throws unhandled; invokes process.exit(0).
   * @invariants Single execution pass; unref'd force-kill timer; exit code 0 on success.
   */
  public async shutdown(_signal: string, server?: ServerType): Promise<void> {
    if (this.isShuttingDown) return;
    this.isShuttingDown = true;

    const forceTimer = setTimeout(() => {
      process.exit(1);
    }, this.timeoutMs);
    forceTimer.unref();

    try {
      if (server) {
        (server as unknown as { closeIdleConnections?: () => void }).closeIdleConnections?.();
        await new Promise<void>((resolve) => {
          server.close(() => resolve());
        });
      }
      await BrowserManager.getInstance().closeAll();
    } finally {
      clearTimeout(forceTimer);
      process.exit(0);
    }
  }
}

export const shutdownCoordinator = new ShutdownCoordinator();

/**
 * @purpose Running Streamable HTTP server instance managed by @hono/node-server.
 * @rationale Serves Streamable HTTP MCP traffic with native HTTP streaming.
 * @invariants Initialized ServerType instance.
 */
export const server = serve({
  fetch: app.fetch,
  port: webResearchConfig.port,
  hostname: webResearchConfig.host,
});

process.on('SIGTERM', () => {
  shutdownCoordinator.shutdown('SIGTERM', server).catch(() => {});
});

process.on('SIGINT', () => {
  shutdownCoordinator.shutdown('SIGINT', server).catch(() => {});
});

// Asynchronously warm-start the persistent browser pool at server boot
BrowserManager.getInstance()
  .warmup()
  .catch(() => {});
