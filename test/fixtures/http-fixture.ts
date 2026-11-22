/**
 * @purpose Local HTTP fixture server for deterministic, offline testing of navigation, redirects, SSRF guards, and content classification.
 * @rationale Provides real HTTP protocol scenarios (302 chains, meta-refresh, JS redirects, HTTP 404/503/204, PDF, attachment, bare UTF-8 without charset) on port 0 with zero external network dependencies.
 * @preconditions Local port binding permissions available.
 * @invariants Ephemeral port-0 binding; strict resource teardown; Big-O time complexity O(1).
 */

import http from 'node:http';

/**
 * @purpose Handle representing a running local HTTP fixture server instance.
 * @rationale Encapsulates port resolution, absolute URL generation, and lifecycle teardown.
 * @invariants Readonly port; clean socket closure on close().
 */
export interface HttpFixtureServer {
  readonly port: number;
  readonly baseUrl: string;
  url(path: string): string;
  close(): Promise<void>;
}

/**
 * @purpose Starts an ephemeral local HTTP test fixture server bound to 127.0.0.1 on port 0.
 * @rationale Powers mutation-proof integration tests covering FR-01 through FR-18 and EC-01 through EC-20 without external network reliance.
 * @preconditions Available loopback interface.
 * @param None.
 * @returns Promise resolving to active HttpFixtureServer handle.
 * @throws Error if socket binding fails.
 * @invariants Binds port 0; non-blocking; thread-safe.
 */
export async function startHttpFixture(): Promise<HttpFixtureServer> {
  const server = http.createServer((req, res) => {
    const parsed = new URL(req.url || '/', `http://127.0.0.1`);
    const pathname = parsed.pathname;

    switch (pathname) {
      case '/redirect-chain': {
        const hops = Number.parseInt(parsed.searchParams.get('hops') || '1', 10);
        if (hops > 1) {
          res.writeHead(302, { Location: `/redirect-chain?hops=${hops - 1}` });
          res.end();
        } else {
          res.writeHead(302, { Location: '/final-page' });
          res.end();
        }
        break;
      }

      case '/redirect-to-private': {
        res.writeHead(302, { Location: 'http://127.0.0.1:3000/internal-health' });
        res.end();
        break;
      }

      case '/meta-refresh': {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head>
              <meta http-equiv="refresh" content="0; url=/final-page">
              <title>Redirecting...</title>
            </head>
            <body>
              <p>Please wait, redirecting...</p>
            </body>
          </html>
        `);
        break;
      }

      case '/js-redirect': {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head>
              <title>Navigating...</title>
              <script>
                setTimeout(() => {
                  window.location.href = '/final-page';
                }, 50);
              </script>
            </head>
            <body>
              <p>Navigating via script...</p>
            </body>
          </html>
        `);
        break;
      }

      case '/status-404': {
        res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head><title>Custom 404</title></head>
            <body>
              <h1>Page Not Found</h1>
              <p>The document you requested does not exist on this test server.</p>
            </body>
          </html>
        `);
        break;
      }

      case '/status-404-empty': {
        res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end();
        break;
      }

      case '/status-503': {
        res.writeHead(503, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head><title>Custom 503</title></head>
            <body>
              <h1>Service Overloaded</h1>
              <p>The server is temporarily experiencing high load.</p>
            </body>
          </html>
        `);
        break;
      }

      case '/status-204': {
        res.writeHead(204);
        res.end();
        break;
      }

      case '/pdf': {
        res.writeHead(200, {
          'Content-Type': 'application/pdf',
          'Content-Length': '24',
        });
        res.end(Buffer.from('%PDF-1.4\n%mock-binary\n%%EOF'));
        break;
      }

      case '/attachment': {
        res.writeHead(200, {
          'Content-Type': 'text/plain',
          'Content-Disposition': 'attachment; filename="data.txt"',
        });
        res.end('Binary attachment file contents');
        break;
      }

      case '/utf8-no-charset': {
        // FR-04: Bare text/html without charset parameter containing non-ASCII UTF-8 characters
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(
          Buffer.from(
            `<!DOCTYPE html>
            <html>
              <head><title>Café</title></head>
              <body>
                <h1>Café crème</h1>
                <p>Délicieux café français et viennoiseries.</p>
              </body>
            </html>`,
            'utf8',
          ),
        );
        break;
      }

      case '/latin1': {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=iso-8859-1' });
        res.end(
          Buffer.from(
            `<!DOCTYPE html>
            <html>
              <head><title>Latin1</title></head>
              <body>
                <h1>Café</h1>
              </body>
            </html>`,
            'latin1',
          ),
        );
        break;
      }

      case '/infinite-feed': {
        const paragraphs = Array.from(
          { length: 50 },
          (_, i) => `<p>Paragraph item ${i + 1} with deep descriptive context.</p>`,
        ).join('\n');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head><title>Infinite Feed</title></head>
            <body>
              <h1>Infinite Feed Document</h1>
              ${paragraphs}
            </body>
          </html>
        `);
        break;
      }

      case '/details-and-button': {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head><title>Interactive Document</title></head>
            <body>
              <main>
                <details id="native-details">
                  <summary>FAQ Section</summary>
                  <p>Expanded FAQ details content</p>
                </details>
                <button id="expander" aria-expanded="false" aria-controls="extra" onclick="document.getElementById('extra').style.display='block'; this.setAttribute('aria-expanded', 'true');">
                  Click to Expand
                </button>
                <div id="extra" style="display:none;">
                  <p>Lazy loaded extra panel content</p>
                </div>
                <button id="mutating-btn" role="button" aria-expanded="false" onclick="document.title='Mutated Title';">
                  Mutate Button
                </button>
              </main>
            </body>
          </html>
        `);
        break;
      }

      case '/final-page': {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head>
              <title>Final Destination</title>
              <meta name="description" content="Landed destination page">
            </head>
            <body>
              <main>
                <h1>Final Landing Title</h1>
                <p>Content of the final landing page.</p>
                <a id="rel-link" href="subpage.html">Relative Link</a>
                <img id="rel-img" src="assets/banner.png" alt="Relative Image">
              </main>
            </body>
          </html>
        `);
        break;
      }

      default: {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
        break;
      }
    }
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to obtain server address');
  }

  const port = address.port;
  const baseUrl = `http://127.0.0.1:${port}`;

  return {
    port,
    baseUrl,
    url: (subPath: string) => `${baseUrl}${subPath.startsWith('/') ? subPath : `/${subPath}`}`,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}
