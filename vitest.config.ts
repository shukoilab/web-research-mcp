/**
 * @purpose Vitest test runner configuration calibrating browser automation timeouts and concurrency.
 * @rationale Disables parallel file execution to prevent Chrome profile SingletonLock contention and extends timeouts to 60s for resilient cold browser boots in 2-core CI environments.
 * @preconditions Vitest testing framework installed in devDependencies.
 * @param None.
 * @returns UserConfig configuration object consumed by Vitest runner.
 * @throws Never throws directly.
 * @invariants Deterministic serial test execution; 60s timeout ceiling across tests and hooks.
 */

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Execute test files sequentially to prevent concurrent worker contention on the Chrome profile directory (~/.cache/mcp-web-research/chrome-profile)
    fileParallelism: false,

    // Provide 60s timeout headroom for cold Google Chrome launches inside virtual framebuffers (Xvfb) on cloud CI runners
    testTimeout: 60000,
    hookTimeout: 60000,
  },
});
