#!/usr/bin/env node
/**
 * @purpose Backpressure-safe, sterile STDIO transport entrypoint for local MCP agents.
 * @rationale Connects local agent environments (Claude Desktop, Cursor, OpenCode) directly to Shukoi actions over standard input/output pipes with redirected console stderr.
 * @preconditions Process stdin and stdout streams must be open.
 * @invariants Sterile stdout JSON-RPC framing; anti-zombie stdin monitoring; thread-safe catalog.
 */

import { compileMcpCatalog, startStdioServer } from '@shukoi/mcp/stdio';
import { googleSearchAction } from '../actions/google-search.js';
import { healthAction } from '../actions/health.js';
import { webExtractAction } from '../actions/web-extract.js';
import { config } from '../config.js';
import { BrowserManager } from '../services/browser.js';

/**
 * @purpose Pre-compiled MCP catalog containing all active actions.
 * @rationale Freezes action schemas at server boot to guarantee zero runtime schema compiling overhead.
 * @invariants Deeply frozen McpCatalog instance.
 */
export const catalog = compileMcpCatalog([healthAction, googleSearchAction, webExtractAction]);

/**
 * @purpose Active STDIO server instance listening on process.stdin.
 * @rationale Serves JSON-RPC requests from standard I/O with backpressure monitoring.
 * @invariants Singleton running server instance.
 */
export const server = startStdioServer(catalog, config);

// Asynchronously warm-start the persistent browser pool at server boot
BrowserManager.getInstance()
  .warmup()
  .catch(() => {});
