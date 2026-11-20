import { DomainError } from '@shukoi/core';
import { afterAll, describe, expect, it } from 'vitest';
import { BrowserManager, smartScrollAndHydrate } from '../src/services/browser.js';

describe('BrowserManager Stealth Integration on DISPLAY=:99', () => {
  const browserManager = BrowserManager.getInstance();

  afterAll(async () => {
    await browserManager.closeAll();
  });

  it('pre-warms persistent browser context and supplies health telemetry', async () => {
    await browserManager.warmup();
    const metrics = browserManager.getHealthMetrics();

    expect(metrics.status).toBe('healthy');
    expect(metrics.connected).toBe(true);
    expect(metrics.prewarmed).toBe(true);
    expect(metrics.userDataDir).toBeDefined();
    expect(metrics.maxCapacity).toBeGreaterThan(0);
    expect(metrics.memory.heapUsedMb).toBeGreaterThan(0);
  });

  it('spawns and closes isolated tabs rapidly on the warm persistent context', async () => {
    // Execute 2 sequential requests measuring tab acquisition speed
    const start1 = Date.now();
    const res1 = await browserManager.withPage(async (page) => {
      await page.setContent('<h1>Tab 1</h1>');
      return await page.textContent('h1');
    });
    const _time1 = Date.now() - start1;

    const start2 = Date.now();
    const res2 = await browserManager.withPage(async (page) => {
      await page.setContent('<h1>Tab 2</h1>');
      return await page.textContent('h1');
    });
    const time2 = Date.now() - start2;

    expect(res1).toBe('Tab 1');
    expect(res2).toBe('Tab 2');
    expect(time2).toBeLessThan(3000);
  });

  it('completes smartScrollAndHydrate within bounded timeout even with background activity', async () => {
    const { duration, isExtraVisible } = await browserManager.withPage(async (page) => {
      await page.setContent(`
        <html>
          <body style="min-height: 2500px;">
            <h1>Long Dynamic Page</h1>
            <button id="expander" aria-expanded="false" aria-controls="extra">Read More</button>
            <div id="extra" style="display: none; height: 800px;">Expanded lazy content</div>
            <script>
              document.getElementById('expander').addEventListener('click', function() {
                document.getElementById('extra').style.display = 'block';
                this.setAttribute('aria-expanded', 'true');
              });
            </script>
          </body>
        </html>
      `);

      const start = Date.now();
      await smartScrollAndHydrate(page, 3);
      const elapsed = Date.now() - start;

      const extraDisplay = await page.$eval('#extra', (el) => window.getComputedStyle(el).display);
      return { duration: elapsed, isExtraVisible: extraDisplay === 'block' };
    });

    expect(duration).toBeLessThan(10000);
    expect(isExtraVisible).toBe(true);
  });

  it('unfolds universal semantic elements (HTML5 details, ARIA, and data-state) while skipping links and submit buttons', async () => {
    const evaluation = await browserManager.withPage(async (page) => {
      await page.setContent(`
        <html>
          <head></head>
          <body style="min-height: 2000px;">
            <details id="native-details">
              <summary>FAQ Summary</summary>
              <p id="faq-content">Deep technical documentation content</p>
            </details>

            <button id="btn-aria" aria-expanded="false" onclick="this.setAttribute('data-clicked', 'true')">
              Expand Specs
            </button>

            <button id="btn-state" data-state="closed" onclick="this.setAttribute('data-clicked', 'true')">
              Accordion Tab
            </button>

            <a id="link-nav" aria-expanded="false" href="https://example.com/login" onclick="this.setAttribute('data-clicked', 'true')">
              Login Link
            </a>

            <button id="btn-submit" type="submit" aria-expanded="false" onclick="this.setAttribute('data-clicked', 'true')">
              Submit Form
            </button>

            <button id="btn-menu" aria-expanded="false" aria-haspopup="menu" onclick="this.setAttribute('data-clicked', 'true')">
              Menu Trigger
            </button>

            <div id="controlled-panel" style="display: none;">Relational content</div>
            <button id="btn-controls" aria-controls="controlled-panel" onclick="this.setAttribute('data-clicked', 'true')">
              Toggle Controls
            </button>
          </body>
        </html>
      `);

      await smartScrollAndHydrate(page, 2);

      return await page.evaluate(() => {
        const details = document.getElementById('native-details') as HTMLDetailsElement;
        const btnAria = document.getElementById('btn-aria');
        const btnState = document.getElementById('btn-state');
        const linkNav = document.getElementById('link-nav');
        const btnSubmit = document.getElementById('btn-submit');
        const btnMenu = document.getElementById('btn-menu');
        const btnControls = document.getElementById('btn-controls');
        const unclampStyle = document.getElementById('mcp-unclamp-style');

        return {
          detailsOpen: details?.open,
          btnAriaClicked: btnAria?.getAttribute('data-clicked') === 'true',
          btnStateClicked: btnState?.getAttribute('data-clicked') === 'true',
          btnControlsClicked: btnControls?.getAttribute('data-clicked') === 'true',
          linkNavClicked: linkNav?.getAttribute('data-clicked') === 'true',
          btnSubmitClicked: btnSubmit?.getAttribute('data-clicked') === 'true',
          btnMenuClicked: btnMenu?.getAttribute('data-clicked') === 'true',
          unclampStyleInjected: unclampStyle !== null,
        };
      });
    });

    expect(evaluation.detailsOpen).toBe(true);
    expect(evaluation.btnAriaClicked).toBe(true);
    expect(evaluation.btnStateClicked).toBe(true);
    expect(evaluation.btnControlsClicked).toBe(true);
    expect(evaluation.linkNavClicked).toBe(false);
    expect(evaluation.btnSubmitClicked).toBe(false);
    expect(evaluation.btnMenuClicked).toBe(false);
    expect(evaluation.unclampStyleInjected).toBe(true);
  });

  it('launches Chrome stealth browser and evaluates page content', async () => {
    const result = await browserManager.withPage(async (page) => {
      await page.setContent(
        '<html><head><title>Test Stealth Page</title></head><body><h1>Hello Patchright</h1></body></html>',
      );
      const title = await page.title();
      const heading = await page.textContent('h1');
      return { title, heading };
    });

    expect(result.title).toBe('Test Stealth Page');
    expect(result.heading).toBe('Hello Patchright');
  });

  it('renders authentic WebGL context on virtual display without synthetic flag leaks', async () => {
    const glInfo = await browserManager.withPage(async (page) => {
      return await page.evaluate(() => {
        const canvas = document.createElement('canvas');
        const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
        if (!gl) return { enabled: false, renderer: '' };
        const debugInfo = (gl as WebGLRenderingContext).getExtension('WEBGL_debug_renderer_info');
        return {
          enabled: true,
          renderer: debugInfo
            ? (gl as WebGLRenderingContext).getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)
            : '',
        };
      });
    });

    expect(glInfo.enabled).toBe(true);
    expect(glInfo.renderer).toBeTruthy();
  });

  it('aborts operation when AbortSignal is pre-triggered', async () => {
    const abortController = new AbortController();
    abortController.abort();

    await expect(
      browserManager.withPage(
        async (page) => {
          await page.goto('data:text/html,<h1>Should not run</h1>');
          return true;
        },
        { signal: abortController.signal },
      ),
    ).rejects.toThrowError(DomainError);
  });

  it('automatically recovers and re-spawns persistent context after browser crash/closure (EC-01)', async () => {
    // Intentionally simulate a context crash/close
    await browserManager.closeAll();
    expect(browserManager.getHealthMetrics().connected).toBe(false);

    // Subsequent operation should transparently re-launch and succeed
    const res = await browserManager.withPage(async (page) => {
      await page.setContent('<h1>Self-Healed After Crash</h1>');
      return await page.textContent('h1');
    });

    expect(res).toBe('Self-Healed After Crash');
    expect(browserManager.getHealthMetrics().connected).toBe(true);
  });

  it('tracks requestsSinceLastRecycle and increments cleanly without thrashing (EC-04)', async () => {
    const initialRequests = browserManager.getHealthMetrics().requestsSinceLastRecycle;
    await browserManager.withPage(async (page) => {
      return await page.title();
    });
    const afterRequests = browserManager.getHealthMetrics().requestsSinceLastRecycle;
    expect(afterRequests).toBe(initialRequests + 1);
  });
});
