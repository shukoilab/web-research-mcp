import { describe, expect, it } from 'vitest';
import {
  getDedupeKey,
  isGoogleTrackingUrl,
  normalizeCanonicalUrl,
} from '../src/services/search.js';

describe('Search Canonical URL Normalizer & Hygiene (FR-07, EC-15, EC-16)', () => {
  it('converts clean breadcrumb cite text with separators into clean URL', () => {
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

  it('drops undecodable Google /goto tracking URLs per FR-07 (EC-15)', () => {
    expect(isGoogleTrackingUrl('https://www.google.com/goto?url=sample')).toBe(true);
    const canonical = normalizeCanonicalUrl(null, 'https://www.google.com/goto?url=sample');
    expect(canonical).toBe('');
  });

  it('drops truncated cite breadcrumbs containing ellipsis per FR-07', () => {
    const canonical = normalizeCanonicalUrl('https://github.com › user › ...', null);
    expect(canonical).toBe('https://github.com/');

    const canonical2 = normalizeCanonicalUrl('https://github.com › user › …', null);
    expect(canonical2).toBe('https://github.com/');
  });

  it('deduplicates URLs based on host, path, and query (EC-16)', () => {
    const key1 = getDedupeKey('https://example.com/docs?v=1#section1');
    const key2 = getDedupeKey('https://example.com/docs/?v=1#section2');
    expect(key1).toBe(key2);
  });

  it('returns empty string if neither cite nor valid href is available', () => {
    const canonical = normalizeCanonicalUrl(null, null);
    expect(canonical).toBe('');
  });
});
