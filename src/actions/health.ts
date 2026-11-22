/**
 * @purpose Protocol-agnostic health, liveness, and readiness probe action (`healthAction`).
 * @rationale Supplies comprehensive subsystem metrics (browser connection status, active tabs, memory, display) for Kubernetes, Docker, and MCP agent monitors without exposing sensitive server paths.
 * @preconditions Server must be initialized; metrics gathered from BrowserManager singleton.
 * @invariants Pure Web-Standard action; zero node:* imports; additionalProperties: false enforced on all schemas.
 */

import { defineAction } from '@shukoi/core';
import { Type } from '@sinclair/typebox';
import { BrowserManager } from '../services/browser.js';

/**
 * @purpose Health check action definition implementing the Shukoi action contract.
 * @rationale Verifies real service readiness, browser persistence, and memory consumption.
 * @invariants Readonly telemetry schema; propagates ctx.logger; zero side effects; zero directory leaks.
 */
export const healthAction = defineAction({
  name: 'healthCheck',
  summary: 'Service liveness and readiness probe',
  description:
    'Returns real-time service health status, browser pool readiness, active tab concurrency, and memory metrics.',
  authRequired: false,
  http: {
    method: 'GET',
    path: '/health',
    successStatus: 200,
  },
  mcp: {
    enabled: true,
    entityType: 'tool',
    annotations: {
      title: 'Service Health Probe',
      readOnlyHint: true,
    },
  },
  input: Type.Object({}, { additionalProperties: false }),
  output: Type.Object(
    {
      status: Type.String({ description: 'Health status: healthy, degraded, or unhealthy' }),
      timestamp: Type.String({ description: 'ISO-8601 evaluation timestamp' }),
      uptimeSec: Type.Integer({ description: 'Process uptime in seconds' }),
      browser: Type.Object(
        {
          connected: Type.Boolean({
            description: 'Whether browser persistent context is connected',
          }),
          prewarmed: Type.Boolean({ description: 'Whether persistent context is pre-warmed' }),
          activeTabs: Type.Integer({ description: 'Count of active concurrent tabs' }),
          maxCapacity: Type.Integer({ description: 'Maximum concurrent tab capacity' }),
          requestCount: Type.Integer({ description: 'Total requests served across lifecycle' }),
        },
        { additionalProperties: false },
      ),
      display: Type.Optional(Type.String({ description: 'Active X11 display target if on Linux' })),
      memory: Type.Object(
        {
          heapUsedMb: Type.Number({ description: 'Node.js heap memory used in megabytes' }),
          rssMb: Type.Number({ description: 'Resident set size memory in megabytes' }),
        },
        { additionalProperties: false },
      ),
    },
    { additionalProperties: false },
  ),
  async handler(_input, ctx) {
    ctx.logger.info('Health probe executed');
    const metrics = BrowserManager.getInstance().getHealthMetrics();

    return {
      status: metrics.status,
      timestamp: new Date().toISOString(),
      uptimeSec: metrics.uptimeSec,
      browser: {
        connected: metrics.connected,
        prewarmed: metrics.prewarmed,
        activeTabs: metrics.activeTabs,
        maxCapacity: metrics.maxCapacity,
        requestCount: metrics.requestCount,
      },
      display: metrics.display,
      memory: {
        heapUsedMb: metrics.memory.heapUsedMb,
        rssMb: metrics.memory.rssMb,
      },
    };
  },
});
