import { describe, expect, it } from 'vitest';
import { normalizeCanonicalUrl } from '../src/services/search.js';

describe('Search Canonical URL Normalizer', () => {
  it('converts breadcrumb cite text with separators into clean URL', () => {
    const canonical = normalizeCanonicalUrl('https://github.com › shuk', null);
    expect(canonical).toBe('https://github.com/shuk');
  });

  it('converts multi-level breadcrumb paths cleanly', () => {
    const canonical = normalizeCanonicalUrl(
      'https://www.typescriptlang.org › docs › handbook',
      null,
    );
    expect(canonical).toBe('https://www.typescriptlang.org/docs/handbook');
  });

  it('handles cite text without separators', () => {
    const canonical = normalizeCanonicalUrl('https://example.com', null);
    expect(canonical).toBe('https://example.com');
  });

  it('falls back to full href when cite is missing or non-http', () => {
    const canonical = normalizeCanonicalUrl(null, 'https://example.com/direct/link');
    expect(canonical).toBe('https://example.com/direct/link');
  });

  it('prepends google domain if relative redirect path is provided', () => {
    const canonical = normalizeCanonicalUrl(null, '/goto?url=sample');
    expect(canonical).toBe('https://www.google.com/goto?url=sample');
  });

  it('returns empty string if neither cite nor valid href is available', () => {
    const canonical = normalizeCanonicalUrl(null, null);
    expect(canonical).toBe('');
  });
});
