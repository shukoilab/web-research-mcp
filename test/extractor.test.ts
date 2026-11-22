import { describe, expect, it } from 'vitest';
import {
  compressMarkdown,
  convertHtmlToMarkdown,
  extractContentToMarkdown,
  hasViableContent,
  truncateMarkdown,
} from '../src/services/extractor.js';

describe('Content Extractor & Markdown Pipeline', () => {
  describe('hasViableContent (near-empty anti-bot interstitials)', () => {
    it('rejects interstitials below the threshold and accepts real content at the boundary', () => {
      expect(hasViableContent('!!!!', 20)).toBe(false);
      expect(hasViableContent('   \n\t ', 20)).toBe(false);
      expect(hasViableContent('1234567890123456789', 20)).toBe(false);
      expect(hasViableContent('12345678901234567890', 20)).toBe(true);
      expect(hasViableContent('  padded content that is long enough  ', 20)).toBe(true);
    });
  });

  describe('compressMarkdown', () => {
    it('collapses multiple blank lines into standard paragraph spacing', () => {
      const input = 'Line 1\n\n\n\n\nLine 2';
      expect(compressMarkdown(input)).toBe('Line 1\n\nLine 2');
    });

    it('prunes empty markdown link brackets and excessive horizontal divider lines', () => {
      const input = 'Content\n\n[]()\n\n====================\n\nFooter';
      const output = compressMarkdown(input);
      expect(output).not.toContain('[]()');
      expect(output).toContain('---');
    });
  });

  describe('truncateMarkdown (FR-15, EC-14)', () => {
    it('returns exact markdown without truncation when within size budget', () => {
      const input = '## Clean Paragraph\n\nShort content.';
      const res = truncateMarkdown(input, 500);
      expect(res.text).toBe(input);
      expect(res.truncated).toBe(false);
    });

    it('cuts markdown at paragraph boundary without corrupting surrogate pairs', () => {
      const p1 = 'First section text with details.';
      const p2 = 'Second section text with emoji 🚀.';
      const input = `${p1}\n\n${p2}`;
      const res = truncateMarkdown(input, p1.length + 5);
      expect(res.truncated).toBe(true);
      expect(res.text).toContain(p1);
      expect(res.text).not.toContain(p2);
      expect(res.text).toContain('[Content truncated due to size budget]');
    });
  });

  describe('convertHtmlToMarkdown', () => {
    it('returns empty string on empty input', async () => {
      const res = await convertHtmlToMarkdown('');
      expect(res).toBe('');
    });

    it('converts HTML headings, formatting, and lists into valid Markdown', async () => {
      const html = `
        <h2>Section Title</h2>
        <p>This is a <strong>bold statement</strong> with a <a href="https://example.com">hyperlink</a>.</p>
        <ul>
          <li>First item</li>
          <li>Second item</li>
        </ul>
      `;
      const md = await convertHtmlToMarkdown(html);
      expect(md).toContain('## Section Title');
      expect(md).toContain('**bold statement**');
      expect(md).toContain('[hyperlink](https://example.com)');
      expect(md).toContain('* First item');
      expect(md).toContain('* Second item');
    });

    it('converts HTML tables into GitHub Flavored Markdown tables', async () => {
      const html = `
        <table>
          <thead>
            <tr><th>Header 1</th><th>Header 2</th></tr>
          </thead>
          <tbody>
            <tr><td>Cell A</td><td>Cell B</td></tr>
          </tbody>
        </table>
      `;
      const md = await convertHtmlToMarkdown(html);
      expect(md).toContain('| Header 1 | Header 2 |');
      expect(md).toContain('Cell A');
      expect(md).toContain('Cell B');
    });
  });

  describe('extractContentToMarkdown', () => {
    it('absolutizes relative href, src, and srcset against finalUrl (FR-05)', async () => {
      const html = `
        <html>
          <head><title>Absolutize Test</title></head>
          <body>
            <main>
              <h1>Relative Links Page</h1>
              <p>Check out our <a href="subpage.html">Subpage</a>.</p>
              <img src="images/photo.jpg" alt="Photo" />
              <img srcset="pic-1x.jpg 1x, pic-2x.jpg 2x" alt="Responsive" />
            </main>
          </body>
        </html>
      `;

      const result = await extractContentToMarkdown(
        html,
        'Absolutize Test',
        undefined,
        'https://example.com/docs/intro.html',
      );

      expect(result.markdown).toContain('[Subpage](https://example.com/docs/subpage.html)');
      expect(result.markdown).toContain('https://example.com/docs/images/photo.jpg');
    });

    it('extracts title and readable article body from structured article HTML', async () => {
      const html = `
        <!DOCTYPE html>
        <html>
          <head>
            <title>My Technical Blog</title>
            <meta name="author" content="Jane Doe" />
          </head>
          <body>
            <nav><a href="/">Home</a></nav>
            <article>
              <h1>Deep Dive into TypeScript 5.7</h1>
              <p class="byline">By Jane Doe</p>
              <p>TypeScript 5.7 introduces several performance optimizations and compiler enhancements that make building robust applications faster than ever before in production environments.</p>
              <p>Additional paragraph providing enough textual content for Mozilla Readability scoring algorithms to reliably classify this as the main article payload.</p>
            </article>
            <footer>Copyright 2026</footer>
          </body>
        </html>
      `;

      const result = await extractContentToMarkdown(html);
      expect(result.title).toContain('Deep Dive into TypeScript 5.7');
      expect(result.markdown).toContain('TypeScript 5.7 introduces');
      expect(result.markdown).not.toContain('Copyright 2026');
      expect(result.markdown).not.toContain('Home');
    });

    it('strips token-wasting decorative avatars and profile thumbnails from extraction', async () => {
      const html = `
        <html>
          <head><title>Product Reviews</title></head>
          <body>
            <main>
              <h1>Review Section</h1>
              <img src="https://example.com/avatar.jpg" alt="foto profil" />
              <p>Great product, highly recommended for daily development workflows!</p>
            </main>
          </body>
        </html>
      `;

      const result = await extractContentToMarkdown(html);
      expect(result.markdown).toContain('Great product');
      expect(result.markdown).not.toContain('foto profil');
      expect(result.markdown).not.toContain('avatar.jpg');
    });

    it('falls back to main or body element when Readability encounters non-article layouts', async () => {
      const html = `
        <html>
          <head><title>Minimal Page</title></head>
          <body>
            <main>
              <h3>Short Notice</h3>
              <p>Notice text content in main container.</p>
            </main>
          </body>
        </html>
      `;

      const result = await extractContentToMarkdown(html);
      expect(result.title).toBe('Minimal Page');
      expect(result.markdown).toContain('### Short Notice');
      expect(result.markdown).toContain('Notice text content in main container.');
    });

    it('detects login walls without fabricating product fields and sets blocked: true (FR-18)', async () => {
      const html = `
        <!DOCTYPE html>
        <html>
          <head>
            <title>PC HP EliteDesk 800 G5 SFF Core i5</title>
            <meta name="description" content="Beli PC HP EliteDesk 800 G5 RAM 16GB SSD 512GB Murah Bergaransi." />
            <meta property="og:title" content="PC HP EliteDesk 800 G5 SFF Core i5" />
          </head>
          <body>
            <div id="modal">
              <h2>Masuk Diperlukan</h2>
              <p>Sepertinya Anda belum masuk. Masuk untuk melanjutkan.</p>
            </div>
          </body>
        </html>
      `;

      const result = await extractContentToMarkdown(
        html,
        'PC HP EliteDesk 800 G5 SFF Core i5 - Toko Resmi',
      );
      expect(result.blocked).toBe(true);
      expect(result.blockReason).toContain('Masuk Diperlukan');
      // Preserves actual page markdown without synthesizing fake notes
      expect(result.markdown).toContain('Masuk Diperlukan');
    });
  });
});
