/**
 * @purpose Content extraction and Markdown transformation pipeline using Linkedom, Mozilla Readability, and Unified.
 * @rationale Parses raw webpage HTML into a lightweight DOM, filters out boilerplate/navigation via Readability heuristics, and compiles clean GitHub Flavored Markdown.
 * @preconditions rawHtml must be a valid HTML string within memory limits.
 * @invariants Pure in-memory transformation; zero DOM memory leaks; Big-O time complexity O(n) where n is HTML byte length.
 */

import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import rehypeParse from 'rehype-parse';
import rehypeRemark from 'rehype-remark';
import remarkGfm from 'remark-gfm';
import remarkStringify from 'remark-stringify';
import { unified } from 'unified';
import { webResearchConfig } from '../config.js';

/**
 * @purpose Structured output result of content extraction.
 * @rationale Encapsulates metadata, article text, and high-fidelity Markdown for consumption by LLMs and downstream workflows.
 * @invariants Readonly data structure.
 */
export interface ExtractedArticle {
  readonly title: string;
  readonly byline: string | null;
  readonly excerpt: string | null;
  readonly markdown: string;
}

// Reusable Unified AST processing pipeline instance (pre-compiled for O(1) instantiation overhead)
const markdownProcessor = unified()
  .use(rehypeParse, { fragment: true })
  .use(rehypeRemark)
  .use(remarkGfm)
  .use(remarkStringify);

/**
 * @purpose Compresses Markdown by pruning redundant dividers, empty links, and excessive blank lines.
 * @rationale Minimizes LLM context window token consumption while preserving authentic content structure.
 * @preconditions rawMd is a valid string.
 * @param rawMd Uncompressed Markdown string.
 * @returns Cleaned and compressed Markdown string.
 * @throws Never throws.
 * @invariants Pure string transformation; Big-O time complexity O(n).
 */
export function compressMarkdown(rawMd: string): string {
  return rawMd
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\[\s*\]\([^)]*\)/g, '')
    .replace(/^[-=]{5,}$/gm, '---')
    .trim();
}

/**
 * @purpose Converts an HTML string or fragment into clean GitHub Flavored Markdown (GFM).
 * @rationale Preserves tabular structures, headers, lists, code blocks, and formatted text while stripping scripts, styles, and decorative tags.
 * @preconditions html is a non-empty string.
 * @param html Cleaned HTML fragment.
 * @returns Serialized Markdown string.
 * @throws Never throws directly; AST errors produce sanitized fallback string.
 * @invariants Big-O time complexity O(n); pure serialization.
 */
export async function convertHtmlToMarkdown(html: string): Promise<string> {
  if (!html || html.trim() === '') {
    return '';
  }
  try {
    const vfile = await markdownProcessor.process(html);
    return compressMarkdown(String(vfile));
  } catch {
    // Basic fallback regex strip if unified processing encounters abnormal malformed tokens
    return compressMarkdown(
      html
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' '),
    );
  }
}

/**
 * @purpose Ingests raw webpage HTML, strips boilerplate, and produces structured article Markdown.
 * @rationale Employs Mozilla Readability heuristics with deterministic fallback to main/body elements and pre-rendered OpenGraph/meta descriptors when pages are non-article layouts or blocked by login walls.
 * @preconditions rawHtml must be a valid HTML string; input size is checked against maxContentLength.
 * @param rawHtml Raw source HTML from browser or fetch response.
 * @param fallbackTitle Optional fallback title if DOM lacks title elements or is replaced by SPA routing.
 * @param fallbackDescription Optional pre-hydration meta description captured before SPA redirection.
 * @returns ExtractedArticle containing clean title, byline, excerpt, and Markdown.
 * @throws Never throws unhandled; returns fallback payload on parse degradation.
 * @invariants Memory bounded by webResearchConfig.maxContentLength; pure DOM manipulation.
 */
export async function extractContentToMarkdown(
  rawHtml: string,
  fallbackTitle = 'Untitled',
  fallbackDescription?: string,
): Promise<ExtractedArticle> {
  const boundedHtml =
    rawHtml.length > webResearchConfig.maxContentLength
      ? rawHtml.slice(0, webResearchConfig.maxContentLength)
      : rawHtml;

  const { document } = parseHTML(boundedHtml);

  // 1. Extract high-fidelity pre-rendered metadata prior to DOM sanitization
  const metaDescription =
    document.querySelector('meta[name="description" i]')?.getAttribute('content')?.trim() ||
    document.querySelector('meta[property="og:description" i]')?.getAttribute('content')?.trim() ||
    document.querySelector('meta[name="twitter:description" i]')?.getAttribute('content')?.trim() ||
    fallbackDescription?.trim() ||
    null;

  const ogTitle =
    document.querySelector('meta[property="og:title" i]')?.getAttribute('content')?.trim() ||
    document.querySelector('meta[name="twitter:title" i]')?.getAttribute('content')?.trim() ||
    null;

  // 2. Extract JSON-LD structured product or article metadata prior to stripping script tags
  let jsonLdDescriptor: string | null = null;
  try {
    const jsonLdScripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (const script of jsonLdScripts) {
      const rawText = script.textContent?.trim();
      if (!rawText) continue;
      try {
        const data = JSON.parse(rawText);
        const items = Array.isArray(data) ? data : [data];
        for (const item of items) {
          if (!item || typeof item !== 'object') continue;
          const itemType = String(item['@type'] || '');
          if (itemType.includes('Product')) {
            const lines: string[] = [];
            if (item.name) lines.push(`**Produk:** ${item.name}`);
            const brand = item.brand?.name || (typeof item.brand === 'string' ? item.brand : null);
            if (brand) lines.push(`**Merek:** ${brand}`);
            const offers = Array.isArray(item.offers) ? item.offers[0] : item.offers;
            if (offers?.price) {
              lines.push(`**Harga:** ${offers.priceCurrency || ''} ${offers.price}`.trim());
            }
            if (item.description) lines.push(`**Deskripsi:** ${item.description}`);
            if (lines.length > 0) {
              jsonLdDescriptor = lines.join('\n\n');
              break;
            }
          }
        }
        if (jsonLdDescriptor) break;
      } catch {
        // Ignore malformed JSON-LD scripts
      }
    }
  } catch {
    // Suppress query selector failures
  }

  // 3. Remove noisy elements (navigation, dialogs, modals, ads, and tracking)
  const noisyElements = document.querySelectorAll(
    'script, style, noscript, svg, iframe, canvas, [role="dialog"], [class*="cookie"], [id*="cookie"]',
  );
  for (const el of noisyElements) {
    el.remove();
  }

  // 4. Remove token-wasting decorative avatars and profile thumbnails
  const avatarImages = document.querySelectorAll(
    'img[alt*="profil" i], img[alt*="avatar" i], img[src*="avatar" i], img[src*="profile" i], img[src*="icon" i]',
  );
  for (const img of avatarImages) {
    img.remove();
  }

  // 5. Determine title candidate hierarchy
  const headingTitle = document.querySelector('h1')?.textContent?.trim();
  const documentTitle = document.querySelector('title')?.textContent?.trim();
  const pageTitle = headingTitle || documentTitle || ogTitle || fallbackTitle;

  // 6. Parse through Mozilla Readability
  let articleContentHtml = '';
  let articleTitle = pageTitle;
  let articleByline: string | null = null;
  let articleExcerpt: string | null = metaDescription;

  try {
    const reader = new Readability(document as unknown as Document, {
      charThreshold: webResearchConfig.readabilityCharThreshold,
    });
    const parsedArticle = reader.parse();

    if (parsedArticle?.content) {
      articleContentHtml = parsedArticle.content;
      articleTitle = headingTitle || parsedArticle.title || ogTitle || pageTitle;
      articleByline = parsedArticle.byline || null;
      articleExcerpt = parsedArticle.excerpt || metaDescription || null;
    }
  } catch {
    // Readability parse failure triggers fallback below
  }

  // 7. Deterministic Fallback if Readability yields empty content
  if (!articleContentHtml || articleContentHtml.trim() === '') {
    const mainEl =
      document.querySelector('main') ||
      document.querySelector('article') ||
      document.querySelector('div[role="main"]') ||
      document.body;

    if (mainEl) {
      const remainingNoise = mainEl.querySelectorAll(
        'script, style, noscript, nav, header, footer, svg, iframe',
      );
      for (const el of remainingNoise) {
        el.remove();
      }
      articleContentHtml = mainEl.innerHTML;
    }
  }

  // 8. Compile and compress to Markdown
  let markdown = await convertHtmlToMarkdown(articleContentHtml);

  // 9. Detect login gates or anti-bot verification walls (e.g. Shopee "Masuk Diperlukan", Cloudflare)
  const LOGIN_BOT_WALL_PATTERNS = [
    /masuk diperlukan/i,
    /login required/i,
    /sign in required/i,
    /please sign in/i,
    /verify you are human/i,
    /attention required!\s*\|\s*cloudflare/i,
    /just a moment\.\.\./i,
    /security check to access/i,
  ];

  const isWallDetected = LOGIN_BOT_WALL_PATTERNS.some((p) => p.test(markdown));

  if (
    isWallDetected &&
    (jsonLdDescriptor ||
      fallbackDescription ||
      metaDescription ||
      ogTitle ||
      (articleTitle && articleTitle !== 'Untitled') ||
      fallbackTitle !== 'Untitled')
  ) {
    const bestTitle =
      fallbackTitle && fallbackTitle !== 'Untitled'
        ? fallbackTitle
        : articleTitle && articleTitle !== 'Untitled'
          ? articleTitle
          : ogTitle || fallbackTitle;

    const summaryText =
      jsonLdDescriptor ||
      fallbackDescription?.trim() ||
      (metaDescription && !LOGIN_BOT_WALL_PATTERNS.some((p) => p.test(metaDescription))
        ? metaDescription
        : null) ||
      (!LOGIN_BOT_WALL_PATTERNS.some((p) => p.test(articleExcerpt || ''))
        ? articleExcerpt
        : null) ||
      'Tidak ada deskripsi tambahan pada metadata halaman ini.';

    markdown = [
      `> [!NOTE]`,
      `> Target URL dilindungi sesi login atau verifikasi anti-bot. Konten berikut berhasil diekstrak secara otomatis dari metadata SSR sebelum dialog intervensi aktif.`,
      ``,
      `# ${bestTitle}`,
      ``,
      `**Deskripsi / Ringkasan:**`,
      summaryText,
    ].join('\n\n');

    articleTitle = bestTitle;
    articleExcerpt = summaryText;
  }

  return {
    title: articleTitle,
    byline: articleByline,
    excerpt: articleExcerpt,
    markdown,
  };
}
