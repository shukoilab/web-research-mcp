/**
 * @purpose Resilient stealth browser manager utilizing Patchright for antibot-resistant automation.
 * @rationale Implements singleton pre-warmed persistent browser context, tab-per-request pooling, self-healing crash recovery, and anti-zombie process lifecycle management.
 * @preconditions Chrome binary and Xvfb display must be available if non-headless mode is configured.
 * @invariants Singleton instance; concurrency bounded by semaphore; zero leaked tab handles; clean exit on process signals.
 */

import fs from 'node:fs';
import { DomainError } from '@shukoi/core';
import { type BrowserContext, chromium, type Page } from 'patchright';
import { parseProxyConfig, webResearchConfig } from '../config.js';

/**
 * @purpose Structured browser health and performance metrics for readiness and liveness probes.
 * @rationale Informs orchestration monitors and AI agents of real browser subsystem status, tab concurrency, and memory consumption.
 * @invariants Readonly telemetry structure.
 */
export interface BrowserHealthMetrics {
  readonly status: 'healthy' | 'degraded' | 'unhealthy';
  readonly connected: boolean;
  readonly prewarmed: boolean;
  readonly activeTabs: number;
  readonly maxCapacity: number;
  readonly requestCount: number;
  readonly requestsSinceLastRecycle: number;
  readonly userDataDir: string;
  readonly display?: string | undefined;
  readonly memory: {
    readonly heapUsedMb: number;
    readonly rssMb: number;
  };
  readonly uptimeSec: number;
}

/**
 * @purpose Granular configuration options parameterizing smart progressive scrolling and XHR hydration.
 * @rationale Permits per-request tuning of scroll delays, maximum iterations, and timeouts to adapt to varying network speeds and page depths.
 * @invariants Readonly options structure.
 */
export interface SmartScrollOptions {
  readonly maxScrolls?: number;
  readonly scrollDelayMs?: number;
  readonly scrollStepPx?: number;
  readonly networkIdleTimeoutMs?: number;
  readonly scrollSettleTimeoutMs?: number;
}

/**
 * @purpose Progressively scrolls down an active page to trigger IntersectionObserver lazy-loading, semantic DOM unfolding (W3C WAI-ARIA and native HTML5 disclosures), and detects DOM height convergence.
 * @rationale Eliminates language-locked regex patterns by adhering to W3C WAI-ARIA accessibility standards (`aria-expanded="false"`, `data-state="closed"`, `aria-controls`), native `<details>` disclosures, and in-browser CSS layout unclamping while preventing navigation hijacking.
 * @preconditions page must be an active, navigated Page instance.
 * @param page Active Patchright Page instance.
 * @param options Optional SmartScrollOptions tuning parameters or maximum scroll count number.
 * @returns Promise resolving once DOM mutations converge or maxScrolls is reached.
 * @throws Never throws directly; failures during scroll evaluation are captured cleanly.
 * @invariants Bounded iteration loop; non-blocking async execution; zero click on `<a>` tags or form buttons; strict idempotency via `data-mcp-unfolded`.
 */
export async function smartScrollAndHydrate(
  page: Page,
  options?: SmartScrollOptions | number,
): Promise<void> {
  const opts: SmartScrollOptions =
    typeof options === 'number' ? { maxScrolls: options } : (options ?? {});

  const maxScrolls = opts.maxScrolls ?? webResearchConfig.maxScrollSteps;
  const scrollDelayMs = opts.scrollDelayMs ?? webResearchConfig.scrollDelayMs;
  const scrollStepPx = opts.scrollStepPx ?? webResearchConfig.scrollStepPx;
  const networkIdleTimeoutMs = opts.networkIdleTimeoutMs ?? webResearchConfig.networkIdleTimeoutMs;
  const scrollSettleTimeoutMs =
    opts.scrollSettleTimeoutMs ?? webResearchConfig.scrollSettleTimeoutMs;

  try {
    // 1. Initial network idle wait with bounded budget to prevent stalls on streaming pages
    await page.waitForLoadState('networkidle', { timeout: networkIdleTimeoutMs }).catch(() => {});

    // 2. Progressive scroll loop inside browser context
    await page.evaluate(
      async ({ maxSteps, stepPx, delayMs }) => {
        const getScrollHeight = () =>
          document.scrollingElement?.scrollHeight ||
          Math.max(document.body?.scrollHeight || 0, document.documentElement?.scrollHeight || 0);

        let lastHeight = getScrollHeight();
        let step = 0;

        while (step < maxSteps) {
          window.scrollBy(0, stepPx);
          await new Promise((resolve) => setTimeout(resolve, delayMs));

          // Pillar 1: Open native HTML5 disclosure details elements (zero click, zero side-effects)
          try {
            const collapsedDetails = document.querySelectorAll('details:not([open])');
            for (const d of collapsedDetails) {
              (d as HTMLDetailsElement).open = true;
            }
          } catch {}

          // Pillar 2 & 3: W3C WAI-ARIA Standards & Relational Controls
          try {
            const candidates = document.querySelectorAll(
              'button:not([data-mcp-unfolded]), [role="button"]:not([data-mcp-unfolded]), summary:not([data-mcp-unfolded])',
            );

            let unfoldedCount = 0;
            const MAX_UNFOLD_PER_STEP = 50;

            for (const el of candidates) {
              if (unfoldedCount >= MAX_UNFOLD_PER_STEP) {
                break;
              }

              // Tag element as inspected to maintain strict idempotency
              el.setAttribute('data-mcp-unfolded', 'true');

              // Strict Safety Guard 1: Never click navigation links or form submit/reset buttons
              if (el.tagName.toLowerCase() === 'a') {
                continue;
              }
              const btnType = el.getAttribute('type');
              if (btnType === 'submit' || btnType === 'reset') {
                continue;
              }

              // Strict Safety Guard 2: Exclude popup menus, dialogs, and modals
              const hasPopup = el.getAttribute('aria-haspopup');
              if (hasPopup === 'menu' || hasPopup === 'dialog' || hasPopup === 'true') {
                continue;
              }

              // Check if element is a closed disclosure / accordion
              const ariaExpanded = el.getAttribute('aria-expanded');
              const dataState = el.getAttribute('data-state');
              const ariaControls = el.getAttribute('aria-controls');

              let shouldTrigger = false;

              // Pillar 2: Explicit ARIA or headless state
              if (ariaExpanded === 'false' || dataState === 'closed') {
                shouldTrigger = true;
              } else if (ariaControls) {
                // Pillar 3: Target panel is currently hidden/collapsed
                const target = document.getElementById(ariaControls);
                if (
                  target &&
                  (target.hasAttribute('hidden') ||
                    target.getAttribute('aria-hidden') === 'true' ||
                    window.getComputedStyle(target).display === 'none')
                ) {
                  shouldTrigger = true;
                }
              }

              if (shouldTrigger) {
                try {
                  (el as HTMLElement).click();
                  unfoldedCount++;
                } catch {}
              }
            }
          } catch {}

          const newHeight = getScrollHeight();
          step++;

          // Convergence check: if height has not increased and viewport is near bottom (with 15px subpixel buffer)
          const currentScroll = window.scrollY || window.pageYOffset || 0;
          if (newHeight === lastHeight && currentScroll + window.innerHeight >= lastHeight - 15) {
            break;
          }
          lastHeight = newHeight;
        }

        // Pillar 4: In-Browser CSS Layout Unclamping Engine
        try {
          const unclampStyle = document.createElement('style');
          unclampStyle.id = 'mcp-unclamp-style';
          unclampStyle.textContent = `
            * {
              -webkit-line-clamp: unset !important;
              max-height: none !important;
              overflow: visible !important;
            }
          `;
          (document.head || document.body)?.appendChild(unclampStyle);
        } catch {}
      },
      { maxSteps: maxScrolls, stepPx: scrollStepPx, delayMs: scrollDelayMs },
    );

    // 3. Brief quiet period for final lazy renders
    await page.waitForTimeout(scrollSettleTimeoutMs).catch(() => {});
  } catch {
    // Suppress scroll failures on non-HTML or restricted pages
  }
}

/**
 * @purpose Concurrency counting semaphore controlling simultaneous active browser operations.
 * @rationale Prevents system memory exhaustion and browser crash under high burst traffic by queuing excess operations.
 * @invariants Permits never exceed capacity; FIFO queuing.
 */
class AsyncSemaphore {
  private permits: number;
  private readonly queue: Array<() => void> = [];

  /**
   * @purpose Constructs a counting semaphore with maximum capacity.
   * @rationale Enforces upper bound on concurrent executions.
   * @preconditions maxCapacity must be an integer >= 1.
   * @param maxCapacity Maximum concurrent permits allowed.
   * @returns Instantiated AsyncSemaphore.
   * @throws Never throws.
   * @invariants Immutable capacity limit.
   */
  constructor(private readonly maxCapacity: number) {
    this.permits = maxCapacity;
  }

  /**
   * @purpose Acquires a single execution permit, awaiting available slot if saturated.
   * @rationale Suspends execution cleanly using promises rather than busy-waiting.
   * @preconditions None; semaphore must be initialized.
   * @param None.
   * @returns Promise resolving when permit is successfully acquired.
   * @throws Never throws directly.
   * @invariants O(1) queue insertion.
   */
  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return;
    }
    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
    });
  }

  /**
   * @purpose Releases an acquired execution permit, notifying queued tasks.
   * @rationale Re-allocates permit immediately to oldest awaiting task.
   * @preconditions None; called when active tab finishes execution.
   * @param None.
   * @returns void
   * @throws Never throws.
   * @invariants O(1) permit restoration.
   */
  release(): void {
    if (this.queue.length > 0) {
      const next = this.queue.shift();
      if (next) next();
    } else {
      this.permits = Math.min(this.maxCapacity, this.permits + 1);
    }
  }
}

/**
 * @purpose Centralized browser manager controlling Patchright Chrome instances with pre-warmed persistent pooling.
 * @rationale Pre-warms a persistent browser context to eliminate cold starts, spawns instant tabs per request, and provides self-healing crash recovery.
 * @invariants Deeply managed singleton; thread-safe async access; anti-zombie signal traps installed.
 */
export class BrowserManager {
  private static instance: BrowserManager | null = null;
  private context: BrowserContext | null = null;
  private readonly semaphore: AsyncSemaphore;
  private isShuttingDown = false;
  private launchPromise: Promise<BrowserContext> | null = null;
  private activeTabs = 0;
  private requestCount = 0;
  private requestsSinceLastRecycle = 0;

  /**
   * @purpose Private constructor initializing semaphore and signal listeners.
   * @rationale Guarantees single-flight instantiation and automatic process shutdown hooks.
   * @preconditions None; private singleton constructor.
   * @param None.
   * @returns Instantiated BrowserManager instance.
   * @throws Never throws.
   * @invariants Private constructor; anti-zombie process signal bindings.
   */
  private constructor() {
    this.semaphore = new AsyncSemaphore(webResearchConfig.maxConcurrentPages);
    this.registerProcessTraps();
  }

  /**
   * @purpose Obtains the global singleton BrowserManager instance.
   * @rationale Provides a single source of truth for browser lifecycle across actions.
   * @preconditions None.
   * @param None.
   * @returns The active BrowserManager singleton.
   * @throws Never throws.
   * @invariants Singleton pattern; O(1) access.
   */
  public static getInstance(): BrowserManager {
    if (!BrowserManager.instance) {
      BrowserManager.instance = new BrowserManager();
    }
    return BrowserManager.instance;
  }

  /**
   * @purpose Attaches SIGINT, SIGTERM, beforeExit, exit, and disconnect traps to guarantee clean browser termination.
   * @rationale Prevents orphaned/zombie Chrome child processes across POSIX and Windows operating systems.
   * @preconditions None.
   * @param None.
   * @returns void
   * @throws Never throws.
   * @invariants Registered once per process lifecycle.
   */
  private registerProcessTraps(): void {
    const cleanup = async () => {
      if (this.isShuttingDown) return;
      this.isShuttingDown = true;
      await this.closeAll().catch(() => {});
    };

    process.once('SIGINT', cleanup);
    process.once('SIGTERM', cleanup);
    process.once('beforeExit', cleanup);
    process.once('exit', cleanup);
    process.once('disconnect', cleanup);
  }

  /**
   * @purpose Launches or retrieves the master pre-warmed persistent BrowserContext.
   * @rationale Uses launchPersistentContext with Google Chrome to retain caches, DNS, and consent cookies with zero fallback to Chromium.
   * @preconditions None; called internally before page acquisition or during warmup.
   * @param None.
   * @returns Active BrowserContext instance.
   * @throws DomainError SERVICE_UNAVAILABLE if browser launch fails or Google Chrome is missing.
   * @invariants Single-flight launch promise to prevent concurrent launch races.
   */
  private async getContext(): Promise<BrowserContext> {
    if (this.isShuttingDown) {
      throw new DomainError('SERVICE_UNAVAILABLE', 'Browser engine is currently shutting down');
    }
    if (this.context) {
      return this.context;
    }
    if (this.launchPromise) {
      return this.launchPromise;
    }

    this.launchPromise = (async () => {
      try {
        fs.mkdirSync(webResearchConfig.userDataDir, { recursive: true });
        const proxy = parseProxyConfig(webResearchConfig.httpProxy);

        const launched = await chromium.launchPersistentContext(webResearchConfig.userDataDir, {
          channel: 'chrome',
          headless: false,
          viewport: null,
          env: {
            ...process.env,
            DISPLAY: process.env.DISPLAY || ':99',
          },
          proxy: proxy
            ? {
                server: proxy.server,
                username: proxy.username,
                password: proxy.password,
              }
            : undefined,
        });

        this.context = launched;
        launched.on('close', () => {
          this.context = null;
        });

        return launched;
      } catch (err: unknown) {
        this.context = null;
        const msg = err instanceof Error ? err.message : String(err);
        if (
          msg.includes('Chromium distribution') ||
          msg.includes('not found') ||
          msg.includes('Cannot find')
        ) {
          throw new DomainError(
            'SERVICE_UNAVAILABLE',
            'Google Chrome binary is required for undetectable stealth automation. Please install Google Chrome or execute "npx patchright install chrome".',
          );
        }
        throw new DomainError(
          'SERVICE_UNAVAILABLE',
          `Failed to launch stealth Chrome persistent context: ${msg}`,
        );
      } finally {
        this.launchPromise = null;
      }
    })();

    return this.launchPromise;
  }

  /**
   * @purpose Pre-warms the persistent browser context during server startup.
   * @rationale Eliminates cold-start latency for the initial user request by ensuring Chrome is active in the background.
   * @preconditions None.
   * @param None.
   * @returns Promise resolving once warmup completes or attempts.
   * @throws Never throws directly; startup warmup failures are caught to avoid halting server boot.
   * @invariants Non-blocking boot helper.
   */
  public async warmup(): Promise<void> {
    try {
      await this.getContext();
    } catch {
      // Suppress warmup failures so server starts, will retry on demand
    }
  }

  /**
   * @purpose Returns live telemetry metrics regarding browser liveness, concurrency, and memory.
   * @rationale Supplies empirical telemetry for HTTP and STDIO health check probes.
   * @preconditions None.
   * @param None.
   * @returns BrowserHealthMetrics object.
   * @throws Never throws.
   * @invariants Pure synchronous metric gathering.
   */
  public getHealthMetrics(): BrowserHealthMetrics {
    const mem = process.memoryUsage();
    const isConnected = this.context !== null;
    return {
      status: isConnected ? 'healthy' : 'degraded',
      connected: isConnected,
      prewarmed: isConnected,
      activeTabs: this.activeTabs,
      maxCapacity: webResearchConfig.maxConcurrentPages,
      requestCount: this.requestCount,
      requestsSinceLastRecycle: this.requestsSinceLastRecycle,
      userDataDir: webResearchConfig.userDataDir,
      display: process.env.DISPLAY || ':99',
      memory: {
        heapUsedMb: Math.round((mem.heapUsed / 1024 / 1024) * 100) / 100,
        rssMb: Math.round((mem.rss / 1024 / 1024) * 100) / 100,
      },
      uptimeSec: Math.round(process.uptime()),
    };
  }

  /**
   * @purpose Executes a scoped operation within an isolated browser page (tab) spawned from the pre-warmed context.
   * @rationale Spawns a new tab in ~100ms, bounds concurrency via semaphore, cleans up DOM memory on tab close, and keeps the master context warm.
   * @preconditions fn must be an async callback; signal is an optional cancellation AbortSignal.
   * @param fn Callback receiving active Page instance.
   * @param options Optional execution controls including timeout and AbortSignal.
   * @returns Result produced by callback fn.
   * @throws DomainError GATEWAY_TIMEOUT on timeout, BAD_REQUEST on abort, or SERVICE_UNAVAILABLE on browser failure.
   * @invariants Complete teardown in finally; tab closed immediately; context retained.
   */
  public async withPage<T>(
    fn: (page: Page) => Promise<T>,
    options?: { signal?: AbortSignal; timeoutMs?: number },
  ): Promise<T> {
    const signal = options?.signal;
    if (signal?.aborted) {
      throw new DomainError('BAD_REQUEST', 'Operation cancelled prior to page acquisition');
    }

    await this.semaphore.acquire();
    this.activeTabs++;
    this.requestCount++;
    this.requestsSinceLastRecycle++;

    // Graceful recycling: if requests since last recycle exceed threshold and this is the only active tab, recycle in background
    if (
      this.requestsSinceLastRecycle >= webResearchConfig.maxRequestsBeforeRecycle &&
      this.activeTabs === 1 &&
      this.context
    ) {
      this.requestsSinceLastRecycle = 0;
      await this.closeAll().catch(() => {});
    }

    let page: Page | null = null;
    let abortListener: (() => void) | null = null;

    try {
      const context = await this.getContext();
      if (signal?.aborted) {
        throw new DomainError('BAD_REQUEST', 'Operation aborted after acquiring browser');
      }

      page = await context.newPage();
      const timeout = options?.timeoutMs ?? webResearchConfig.browserTimeoutMs;
      page.setDefaultTimeout(timeout);
      page.setDefaultNavigationTimeout(timeout);

      if (signal) {
        abortListener = () => {
          if (page) {
            page.close().catch(() => {});
          }
        };
        signal.addEventListener('abort', abortListener, { once: true });
      }

      return await fn(page);
    } catch (err: unknown) {
      if (signal?.aborted) {
        throw new DomainError('BAD_REQUEST', 'Request was cancelled by client');
      }
      if (err instanceof DomainError) {
        throw err;
      }
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('Timeout') || msg.includes('timeout')) {
        throw new DomainError('GATEWAY_TIMEOUT', `Browser operation timed out: ${msg}`);
      }
      throw new DomainError('INTERNAL_SERVER_ERROR', `Browser execution failed: ${msg}`);
    } finally {
      if (signal && abortListener) {
        signal.removeEventListener('abort', abortListener);
      }
      if (page) {
        await page.close().catch(() => {});
      }
      this.activeTabs = Math.max(0, this.activeTabs - 1);
      this.semaphore.release();
    }
  }

  /**
   * @purpose Closes the persistent browser context and releases all resources.
   * @rationale Gracefully drains active handles and removes file locks cleanly.
   * @preconditions None.
   * @param None.
   * @returns Promise resolving once context is fully terminated.
   * @throws Never throws unhandled.
   * @invariants Idempotent shutdown; context handle nullified.
   */
  public async closeAll(): Promise<void> {
    if (this.context) {
      try {
        await this.context.close();
      } catch {
        // Suppress teardown error on exit
      } finally {
        this.context = null;
      }
    }
  }
}
