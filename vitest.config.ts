/**
 * @purpose Vitest test runner configuration calibrating browser automation timeouts and concurrency.
 * @rationale Disables parallel file execution to prevent Chrome profile SingletonLock contention and extends timeouts to 30s for resilient cold browser boots in 2-core CI environments.
 * @preconditions Vitest testing framework installed in devDependencies.
 * @invariants Deterministic serial test execution; 30s timeout ceiling across tests and hooks.
 */

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Execute test files sequentially to prevent concurrent worker contention on the Chrome profile directory (~/.cache/mcp-web-research/chrome-profile)
    fileParallelism: false,

    // Provide 30s timeout headroom for cold Google Chrome launches inside virtual framebuffers (Xvfb) on cloud CI runners
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
