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
 * @rationale Employs Mozilla Readability heuristics with deterministic fallback to main/body elements when pages are non-article layouts (catalogs, portals, landing pages).
 * @preconditions rawHtml must be a valid HTML string; input size is checked against maxContentLength.
 * @param rawHtml Raw source HTML from browser or fetch response.
 * @param fallbackTitle Optional fallback title if DOM lacks title elements.
 * @returns ExtractedArticle containing clean title, byline, excerpt, and Markdown.
 * @throws Never throws unhandled; returns fallback payload on parse degradation.
 * @invariants Memory bounded by webResearchConfig.maxContentLength; pure DOM manipulation.
 */
export async function extractContentToMarkdown(
  rawHtml: string,
  fallbackTitle = 'Untitled',
): Promise<ExtractedArticle> {
  const boundedHtml =
    rawHtml.length > webResearchConfig.maxContentLength
      ? rawHtml.slice(0, webResearchConfig.maxContentLength)
      : rawHtml;

  const { document } = parseHTML(boundedHtml);

  // 1. Remove noisy elements (navigation, dialogs, modals, ads, and tracking)
  const noisyElements = document.querySelectorAll(
    'script, style, noscript, svg, iframe, canvas, [role="dialog"], [class*="cookie"], [id*="cookie"]',
  );
  for (const el of noisyElements) {
    el.remove();
  }

  // 2. Remove token-wasting decorative avatars and profile thumbnails
  const avatarImages = document.querySelectorAll(
    'img[alt*="profil" i], img[alt*="avatar" i], img[src*="avatar" i], img[src*="profile" i], img[src*="icon" i]',
  );
  for (const img of avatarImages) {
    img.remove();
  }

  // 3. Determine title
  const headingTitle = document.querySelector('h1')?.textContent?.trim();
  const documentTitle = document.querySelector('title')?.textContent?.trim();
  const pageTitle = headingTitle || documentTitle || fallbackTitle;

  // 4. Parse through Mozilla Readability
  let articleContentHtml = '';
  let articleTitle = pageTitle;
  let articleByline: string | null = null;
  let articleExcerpt: string | null = null;

  try {
    const reader = new Readability(document as unknown as Document, {
      charThreshold: webResearchConfig.readabilityCharThreshold,
    });
    const parsedArticle = reader.parse();

    if (parsedArticle?.content) {
      articleContentHtml = parsedArticle.content;
      articleTitle = headingTitle || parsedArticle.title || pageTitle;
      articleByline = parsedArticle.byline || null;
      articleExcerpt = parsedArticle.excerpt || null;
    }
  } catch {
    // Readability parse failure triggers fallback below
  }

  // 5. Deterministic Fallback if Readability yields empty content
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

  // 6. Compile and compress to Markdown
  const markdown = await convertHtmlToMarkdown(articleContentHtml);

  return {
    title: articleTitle,
    byline: articleByline,
    excerpt: articleExcerpt,
    markdown,
  };
}
