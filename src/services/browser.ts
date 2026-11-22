/**
 * @purpose Resilient stealth browser manager utilizing Patchright for antibot-resistant automation.
 * @rationale Implements singleton pre-warmed persistent browser context, signal-aware counting semaphore with bounded queue, self-healing crash recovery, and anti-zombie process lifecycle management.
 * @preconditions Chrome binary and Xvfb display must be available if non-headless mode is configured.
 * @invariants Singleton instance; concurrency bounded by semaphore; zero leaked tab handles; clean exit on process signals.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { DomainError } from '@shukoi/core';
import { type BrowserContext, chromium, type Page } from 'patchright';
import { parseProxyConfig, webResearchConfig } from '../config.js';
import { Deadline } from './deadline.js';

/**
 * @purpose Ensures an X11 virtual framebuffer (Xvfb) is active on DISPLAY=:99 on Linux platforms.
 * @rationale Strictly prevents Google Chrome from ever rendering or opening windows on physical host displays (:0, :1), guaranteeing 100% invisible execution across bare metal and container environments with automated self-healing against stale locks.
 * @preconditions Linux operating system environment.
 * @param None.
 * @returns Void.
 * @throws Never throws directly; suppresses spawn error events when Xvfb binary is missing.
 * @invariants Idempotent; Big-O time complexity O(1); non-spinning synchronous sleep.
 */
export function ensureVirtualDisplay(): void {
  if (process.platform !== 'linux') return;

  const lockPath = webResearchConfig.xvfbLockPath;
  const socketPath = webResearchConfig.xvfbSocketPath;

  // Self-healing check: verify if an active process genuinely owns the X99 display lock
  if (fs.existsSync(lockPath)) {
    try {
      const lockContent = fs.readFileSync(lockPath, 'utf8').trim();
      const pid = Number.parseInt(lockContent, 10);
      if (!Number.isNaN(pid) && pid > 0) {
        try {
          process.kill(pid, 0);
          // Process is actively running; check if socket is ready or wait briefly for socket initialization
          if (fs.existsSync(socketPath)) {
            return;
          }
          const sleepBuffer = new Int32Array(new SharedArrayBuffer(4));
          for (let i = 0; i < 10; i++) {
            Atomics.wait(sleepBuffer, 0, 0, 50);
            if (fs.existsSync(socketPath)) return;
          }
        } catch {
          // Process does not exist (ESRCH); clean up stale lock and socket
          try {
            fs.unlinkSync(lockPath);
          } catch {}
          try {
            if (fs.existsSync(socketPath)) fs.unlinkSync(socketPath);
          } catch {}
        }
      } else {
        try {
          fs.unlinkSync(lockPath);
        } catch {}
      }
    } catch {
      // Suppress read errors defensively
    }
  } else if (fs.existsSync(socketPath)) {
    // Socket exists without a lock file (orphaned socket after crash)
    try {
      fs.unlinkSync(socketPath);
    } catch {}
  }

  try {
    const proc = spawn(
      'Xvfb',
      [
        webResearchConfig.defaultXvfbDisplay,
        '-screen',
        '0',
        webResearchConfig.xvfbScreenResolution,
        '-nolisten',
        'tcp',
        '-ac',
        '+extension',
        'GLX',
        '+render',
        '-noreset',
      ],
      {
        detached: true,
        stdio: 'ignore',
      },
    );
    proc.on('error', () => {
      // Gracefully suppress missing binary or invocation failure so process does not crash (CWE-755)
    });
    proc.unref();

    // Bounded non-spinning wait for X11 socket creation (max 1500ms)
    const sleepBuffer = new Int32Array(new SharedArrayBuffer(4));
    for (let i = 0; i < 30; i++) {
      if (fs.existsSync(socketPath)) break;
      Atomics.wait(sleepBuffer, 0, 0, 50);
    }
  } catch {
    // If invocation fails synchronously, handled gracefully
  }
}

/**
 * @purpose Removes stale Google Chrome Singleton lock files from persistent user data directory.
 * @rationale Abrupt container termination or power failures leave SingletonLock files preventing subsequent Chrome browser startup.
 * @preconditions userDataDir must be a valid directory path string.
 * @param userDataDir Path to persistent Chrome user profile directory.
 * @returns Void.
 * @throws Never throws directly; filesystem errors are handled defensively.
 * @invariants Pure filesystem cleanup; idempotent; Big-O time complexity O(1).
 */
export function cleanStaleChromeLocks(userDataDir: string): void {
  try {
    const lockFiles = ['SingletonLock', 'SingletonCookie', 'SingletonSocket'];
    for (const file of lockFiles) {
      const filePath = path.join(userDataDir, file);
      try {
        fs.rmSync(filePath, { force: true });
      } catch {}
    }
  } catch {
    // Suppress lock cleanup errors gracefully
  }
}

/**
 * @purpose Resolves the active or required X11 display string on Linux or returns undefined on non-Linux platforms.
 * @rationale Reuses existing virtual displays (such as those allocated by xvfb-run or container entrypoints) to prevent dual-daemon clashing, while isolating physical desktop displays (:0, :1) or unset environments to virtual display :99.
 * @preconditions None.
 * @param None.
 * @returns Target DISPLAY string (e.g. ':99', ':100') on Linux, or undefined on macOS and Windows.
 * @throws Never throws directly.
 * @invariants Pure read/spawn coordination; idempotent; Big-O time complexity O(1).
 */
export function resolveDisplay(): string | undefined {
  if (process.platform !== 'linux') return undefined;

  const currentDisplay = process.env.DISPLAY;
  if (currentDisplay && currentDisplay !== ':0' && currentDisplay !== ':1') {
    if (currentDisplay === webResearchConfig.defaultXvfbDisplay) {
      ensureVirtualDisplay();
    }
    return currentDisplay;
  }

  ensureVirtualDisplay();
  return webResearchConfig.defaultXvfbDisplay;
}

/**
 * @purpose Structured browser health and performance metrics for readiness and liveness probes.
 * @rationale Informs orchestration monitors and AI agents of real browser subsystem status, tab concurrency, and memory consumption without sensitive directory leaks.
 * @invariants Readonly telemetry structure.
 */
export interface BrowserHealthMetrics {
  readonly status: 'healthy' | 'degraded' | 'unhealthy';
  readonly connected: boolean;
  readonly prewarmed: boolean;
  readonly activeTabs: number;
  readonly maxCapacity: number;
  readonly queuedRequests: number;
  readonly requestCount: number;
  readonly requestsSinceLastRecycle: number;
  readonly display?: string | undefined;
  readonly memory: {
    readonly heapUsedMb: number;
    readonly rssMb: number;
  };
  readonly uptimeSec: number;
}

/**
 * @purpose Intercepts and blocks non-essential subresources (images, stylesheets, fonts, media, text tracks, manifests) for a specific page.
 * @rationale Significantly accelerates navigation and minimizes bandwidth consumption during text-focused web extraction while preserving Patchright stealth init-scripts via route.fallback().
 * @preconditions page must be an active, unclosed Page instance prior to navigation.
 * @param page Active Patchright Page instance to attach the route interceptor to.
 * @returns Promise resolving once the route handler is registered on the page.
 * @throws Never throws directly; route abort and fallback rejections during page teardown are caught and swallowed.
 * @invariants Page-scoped interception; O(1) resource lookup; zero persistent context pollution; thread-safe.
 */
export async function blockHeavyResources(page: Page): Promise<void> {
  const blockedTypes = new Set(webResearchConfig.blockedResourceTypes);
  await page.route('**/*', async (route) => {
    const resourceType = route.request().resourceType();
    if (blockedTypes.has(resourceType)) {
      await route.abort('blockedbyclient').catch(() => {});
    } else {
      await route.fallback().catch(() => {});
    }
  });
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
  readonly unfoldInteractive?: boolean;
}

/**
 * @purpose Progressively scrolls down an active page to trigger IntersectionObserver lazy-loading, semantic DOM unfolding (W3C WAI-ARIA and native HTML5 disclosures), and detects DOM height convergence.
 * @rationale Eliminates language-locked regex patterns by adhering to W3C WAI-ARIA accessibility standards (`aria-expanded="false"`, `aria-controls`), native `<details>` disclosures, and safe bounded DOM interaction without navigation hijacking.
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
  const unfoldInteractive = opts.unfoldInteractive ?? webResearchConfig.unfoldInteractive;
  const maxUnfoldPerPage = webResearchConfig.maxUnfoldPerPage;

  try {
    // 1. Initial network idle wait with bounded budget to prevent stalls on streaming pages
    await page.waitForLoadState('networkidle', { timeout: networkIdleTimeoutMs }).catch(() => {});

    // 2. Progressive scroll loop inside browser context
    await page.evaluate(
      async ({ maxSteps, stepPx, delayMs, shouldUnfold, maxUnfold }) => {
        const getScrollHeight = () =>
          document.scrollingElement?.scrollHeight ||
          Math.max(document.body?.scrollHeight || 0, document.documentElement?.scrollHeight || 0);

        let lastHeight = getScrollHeight();
        let step = 0;
        let totalUnfolded = 0;

        while (step < maxSteps) {
          window.scrollBy(0, stepPx);
          await new Promise((resolve) => setTimeout(resolve, delayMs));

          // Native HTML5 disclosure details elements (zero click, zero side-effects)
          try {
            const collapsedDetails = document.querySelectorAll('details:not([open])');
            for (const d of collapsedDetails) {
              (d as HTMLDetailsElement).open = true;
            }
          } catch {}

          // Interactive W3C WAI-ARIA disclosure unfolding (strictly opt-in via unfoldInteractive)
          if (shouldUnfold && totalUnfolded < maxUnfold) {
            try {
              // Target only candidates inside main, article, or role=main container
              const contentRoot =
                document.querySelector('main, article, [role="main"]') || document.body;

              const candidates = contentRoot.querySelectorAll(
                'button:not([data-mcp-unfolded]), [role="button"]:not([data-mcp-unfolded]), summary:not([data-mcp-unfolded])',
              );

              for (const el of candidates) {
                if (totalUnfolded >= maxUnfold) break;

                el.setAttribute('data-mcp-unfolded', 'true');

                // Strict Safety Guard 1: Never click links or submit/reset buttons
                if (el.tagName.toLowerCase() === 'a') continue;
                const btnType = el.getAttribute('type');
                if (btnType === 'submit' || btnType === 'reset') continue;

                // Strict Safety Guard 2: Exclude popup menus, dialogs, and modals
                const hasPopup = el.getAttribute('aria-haspopup');
                if (hasPopup === 'menu' || hasPopup === 'dialog' || hasPopup === 'true') continue;

                const ariaExpanded = el.getAttribute('aria-expanded');
                const ariaControls = el.getAttribute('aria-controls');

                // FR-09: a disclosure is only safe when it controls a hidden panel.
                // aria-expanded="false" alone may be a mutating action (buy, delete, logout).
                let shouldTrigger = false;
                if (ariaControls && ariaExpanded !== 'true') {
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

                if (shouldTrigger && el.isConnected) {
                  try {
                    (el as HTMLElement).click();
                    totalUnfolded++;
                  } catch {}
                }
              }
            } catch {}
          }

          const newHeight = getScrollHeight();
          step++;

          // Convergence check: if height has not increased and viewport is near bottom
          const currentScroll = window.scrollY || window.pageYOffset || 0;
          if (newHeight === lastHeight && currentScroll + window.innerHeight >= lastHeight - 15) {
            break;
          }
          lastHeight = newHeight;
        }
      },
      {
        maxSteps: maxScrolls,
        stepPx: scrollStepPx,
        delayMs: scrollDelayMs,
        shouldUnfold: unfoldInteractive,
        maxUnfold: maxUnfoldPerPage,
      },
    );

    // 3. Brief quiet period for final lazy renders
    await page.waitForTimeout(scrollSettleTimeoutMs).catch(() => {});
  } catch {
    // Suppress scroll failures on non-HTML or restricted pages
  }
}

/**
 * @purpose Queue entry tracking an awaiting execution permit in AsyncSemaphore.
 * @rationale Stores resolve/reject handlers, cancellation tokens, and optional timeout timer for cooperative abortion.
 * @invariants Internal queue record.
 */
interface SemaphoreQueueEntry {
  resolve: () => void;
  reject: (err: unknown) => void;
  signal?: AbortSignal;
  timeoutHandle?: NodeJS.Timeout;
}

/**
 * @purpose Concurrency counting semaphore controlling simultaneous active browser operations with queue limit and signal awareness.
 * @rationale Prevents system memory exhaustion under burst traffic by queuing operations, bounds queue depth to prevent memory leaks, and purges aborted requests.
 * @invariants Permits never exceed capacity; FIFO queuing; aborted requests removed immediately.
 */
export class AsyncSemaphore {
  private permits: number;
  private readonly maxCapacity: number;
  private readonly maxQueueLength: number;
  private readonly queue: SemaphoreQueueEntry[] = [];

  /**
   * @purpose Constructs a counting semaphore with maximum capacity and maximum queue length.
   * @rationale Enforces strict upper bounds on both concurrency and queued pending operations.
   * @preconditions maxCapacity >= 1; maxQueueLength >= 1.
   * @param maxCapacity Maximum concurrent permits allowed.
   * @param maxQueueLength Maximum queue capacity before rejecting with 429.
   * @returns Instantiated AsyncSemaphore.
   * @throws Never throws.
   * @invariants Immutable capacity limits.
   */
  constructor(maxCapacity: number, maxQueueLength = webResearchConfig.maxQueueLength) {
    this.maxCapacity = Math.max(1, maxCapacity);
    this.maxQueueLength = Math.max(1, maxQueueLength);
    this.permits = this.maxCapacity;
  }

  /**
   * @purpose Returns the number of currently queued awaiting requests.
   * @rationale Supplies empirical telemetry for monitoring queue health and capacity saturation.
   * @preconditions None.
   * @param None.
   * @returns Non-negative integer count of queued waiters.
   * @throws Never throws.
   * @invariants Big-O time complexity O(1).
   */
  public get queueLength(): number {
    return this.queue.length;
  }

  /**
   * @purpose Acquires a single execution permit, awaiting available slot if saturated, respecting cancellation signals and queue capacity limits.
   * @rationale Suspends execution cleanly using promises rather than busy-waiting, purges waiters upon client abort, and rejects excess bursts.
   * @preconditions None; semaphore must be initialized.
   * @param options Optional controls including AbortSignal and timeout duration.
   * @returns Promise resolving when permit is successfully acquired.
   * @throws DomainError BAD_REQUEST if cancelled, GATEWAY_TIMEOUT on timeout, or RATE_LIMIT_EXCEEDED if queue capacity is breached.
   * @invariants Aborted entries cleanly spliced from queue; Big-O time complexity O(1) permit acquisition.
   */
  async acquire(options?: { signal?: AbortSignal; timeoutMs?: number }): Promise<void> {
    const signal = options?.signal;
    if (signal?.aborted) {
      throw new DomainError('BAD_REQUEST', 'Operation cancelled prior to permit acquisition');
    }

    if (this.permits > 0) {
      this.permits--;
      return;
    }

    if (this.queue.length >= this.maxQueueLength) {
      throw new DomainError(
        'RATE_LIMIT_EXCEEDED',
        `Concurrency queue capacity of ${this.maxQueueLength} exceeded. Request rejected.`,
      );
    }

    return new Promise<void>((resolve, reject) => {
      let entry: SemaphoreQueueEntry;

      const cleanup = () => {
        const idx = this.queue.indexOf(entry);
        if (idx !== -1) {
          this.queue.splice(idx, 1);
        }
        if (entry.timeoutHandle) {
          clearTimeout(entry.timeoutHandle);
        }
        if (signal && abortListener) {
          signal.removeEventListener('abort', abortListener);
        }
      };

      const abortListener = () => {
        cleanup();
        reject(new DomainError('BAD_REQUEST', 'Request was cancelled by client'));
      };

      entry = {
        resolve: () => {
          cleanup();
          resolve();
        },
        reject: (err) => {
          cleanup();
          reject(err);
        },
        signal,
      };

      if (signal) {
        signal.addEventListener('abort', abortListener, { once: true });
      }

      if (options?.timeoutMs && options.timeoutMs > 0) {
        entry.timeoutHandle = setTimeout(() => {
          cleanup();
          reject(new DomainError('GATEWAY_TIMEOUT', 'Timed out waiting for concurrency permit'));
        }, options.timeoutMs);
      }

      this.queue.push(entry);
    });
  }

  /**
   * @purpose Releases an acquired execution permit, notifying queued tasks.
   * @rationale Re-allocates permit immediately to oldest un-aborted awaiting task.
   * @preconditions None; called when active tab finishes execution.
   * @param None.
   * @returns void
   * @throws Never throws.
   * @invariants O(1) permit restoration.
   */
  release(): void {
    while (this.queue.length > 0) {
      const next = this.queue.shift();
      if (next && !next.signal?.aborted) {
        next.resolve();
        return;
      }
    }
    this.permits = Math.min(this.maxCapacity, this.permits + 1);
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
    this.semaphore = new AsyncSemaphore(
      webResearchConfig.maxConcurrentPages,
      webResearchConfig.maxQueueLength,
    );
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
   * @purpose Attaches SIGINT and SIGTERM traps to guarantee clean browser termination.
   * @rationale Prevents orphaned/zombie Chrome child processes across operating systems with consolidated shutdown coordination.
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
  public async getContext(): Promise<BrowserContext> {
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
        cleanStaleChromeLocks(webResearchConfig.userDataDir);
        const proxy = parseProxyConfig(webResearchConfig.httpProxy);
        const targetDisplay = resolveDisplay();
        const displayEnv = targetDisplay ? { DISPLAY: targetDisplay } : {};

        const isNonRoot = typeof process.getuid === 'function' ? process.getuid() !== 0 : true;
        const useSandbox = !process.env.CI && isNonRoot;

        const launched = await chromium.launchPersistentContext(webResearchConfig.userDataDir, {
          channel: webResearchConfig.chromeChannel,
          headless: false,
          viewport: null,
          chromiumSandbox: useSandbox,
          timeout: Math.max(60000, webResearchConfig.browserTimeoutMs),
          env: {
            ...process.env,
            ...displayEnv,
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
   * @purpose Returns live telemetry metrics regarding browser liveness, concurrency, and memory without spawning processes or blocking the event loop.
   * @rationale Supplies fast, read-only empirical telemetry for HTTP and STDIO health check probes.
   * @preconditions None.
   * @param None.
   * @returns BrowserHealthMetrics object.
   * @throws Never throws.
   * @invariants Pure synchronous metric gathering; zero external child process spawning; zero Atomics.wait.
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
      queuedRequests: this.semaphore.queueLength,
      requestCount: this.requestCount,
      requestsSinceLastRecycle: this.requestsSinceLastRecycle,
      display: process.env.DISPLAY || webResearchConfig.defaultXvfbDisplay,
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

    const effectiveTimeout = options?.timeoutMs ?? webResearchConfig.browserTimeoutMs;
    const deadline = Deadline.create(effectiveTimeout, signal);

    await this.semaphore.acquire({
      signal,
      timeoutMs: deadline.remaining,
    });

    this.activeTabs++;
    this.requestCount++;
    this.requestsSinceLastRecycle++;

    // Graceful recycling: if requests since last recycle exceed threshold and this is the only active tab, recycle
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
      deadline.throwIfExpired();
      const context = await this.getContext();
      deadline.throwIfExpired();

      page = await context.newPage();
      const remainingTimeout = Math.max(1000, deadline.remaining);
      page.setDefaultTimeout(remainingTimeout);
      page.setDefaultNavigationTimeout(remainingTimeout);

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
