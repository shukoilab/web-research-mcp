import { DomainError } from '@shukoi/core';
import { describe, expect, it } from 'vitest';
import {
  assertPublicUrl,
  checkPublicUrl,
  isPrivateIpv4,
  isPrivateIpv6,
  validatePublicUrl,
} from '../src/services/ssrf.js';

describe('SSRF Protection Service', () => {
  describe('isPrivateIpv4', () => {
    it('identifies private and reserved IPv4 addresses', () => {
      expect(isPrivateIpv4('127.0.0.1')).toBe(true);
      expect(isPrivateIpv4('10.0.1.25')).toBe(true);
      expect(isPrivateIpv4('172.16.0.1')).toBe(true);
      expect(isPrivateIpv4('172.31.255.254')).toBe(true);
      expect(isPrivateIpv4('192.168.1.1')).toBe(true);
      expect(isPrivateIpv4('169.254.169.254')).toBe(true);
      expect(isPrivateIpv4('0.0.0.0')).toBe(true);
      expect(isPrivateIpv4('224.0.0.1')).toBe(true);
      expect(isPrivateIpv4('240.0.0.1')).toBe(true);
      expect(isPrivateIpv4('192.0.2.1')).toBe(true);
      expect(isPrivateIpv4('198.51.100.1')).toBe(true);
      expect(isPrivateIpv4('203.0.113.1')).toBe(true);
    });

    it('identifies public IPv4 addresses as non-private', () => {
      expect(isPrivateIpv4('8.8.8.8')).toBe(false);
      expect(isPrivateIpv4('1.1.1.1')).toBe(false);
      expect(isPrivateIpv4('142.250.190.46')).toBe(false);
    });
  });

  describe('isPrivateIpv6', () => {
    it('identifies private, loopback, and translation IPv6 addresses (FR-01, VC-04)', () => {
      expect(isPrivateIpv6('::1')).toBe(true);
      expect(isPrivateIpv6('[::1]')).toBe(true);
      expect(isPrivateIpv6('0000:0000:0000:0000:0000:0000:0000:0001')).toBe(true);
      expect(isPrivateIpv6('fc00::1')).toBe(true);
      expect(isPrivateIpv6('fe80::1')).toBe(true);
      expect(isPrivateIpv6('::ffff:127.0.0.1')).toBe(true);
      expect(isPrivateIpv6('::ffff:192.168.0.1')).toBe(true);
      // New IPv6 ranges: 64:ff9b::/96, 2002::/16, fd00:ec2::254, 100::/64
      expect(isPrivateIpv6('64:ff9b::127.0.0.1')).toBe(true);
      expect(isPrivateIpv6('2002:c0a8:0101::1')).toBe(true);
      expect(isPrivateIpv6('fd00:ec2::254')).toBe(true);
      expect(isPrivateIpv6('100::1')).toBe(true);
    });

    it('identifies public IPv6 addresses as non-private', () => {
      expect(isPrivateIpv6('2606:4700:4700::1111')).toBe(false);
    });
  });

  describe('validatePublicUrl', () => {
    it('allows valid public HTTP and HTTPS endpoints', () => {
      const u1 = validatePublicUrl('https://example.com/test');
      expect(u1.protocol).toBe('https:');
      expect(u1.hostname).toBe('example.com');

      const u2 = validatePublicUrl('http://142.250.190.46/search');
      expect(u2.protocol).toBe('http:');
      expect(u2.hostname).toBe('142.250.190.46');
    });

    it('rejects unsupported protocols', () => {
      expect(() => validatePublicUrl('ftp://example.com')).toThrowError(DomainError);
      expect(() => validatePublicUrl('file:///etc/passwd')).toThrowError(DomainError);
      expect(() => validatePublicUrl('javascript:alert(1)')).toThrowError(DomainError);
      expect(() => validatePublicUrl('data:text/html,hello')).toThrowError(DomainError);
      expect(() => validatePublicUrl('gopher://example.com')).toThrowError(DomainError);
    });

    it('rejects localhost, trailing dots, and internal suffixes (FR-01, EC-03)', () => {
      expect(() => validatePublicUrl('http://localhost:3000')).toThrowError(DomainError);
      expect(() => validatePublicUrl('http://localhost.')).toThrowError(DomainError);
      expect(() => validatePublicUrl('http://app.localhost')).toThrowError(DomainError);
      expect(() => validatePublicUrl('http://myhost.local')).toThrowError(DomainError);
      expect(() => validatePublicUrl('http://service.internal')).toThrowError(DomainError);
      expect(() => validatePublicUrl('http://node.localdomain')).toThrowError(DomainError);
      expect(() => validatePublicUrl('http://metadata.google.internal')).toThrowError(DomainError);
      expect(() => validatePublicUrl('http://metadata')).toThrowError(DomainError);
      expect(() => validatePublicUrl('http://instance-data')).toThrowError(DomainError);
    });

    it('rejects private IPv4 targets', () => {
      expect(() => validatePublicUrl('http://127.0.0.1:8080')).toThrowError(DomainError);
      expect(() => validatePublicUrl('http://169.254.169.254/latest/meta-data')).toThrowError(
        DomainError,
      );
      expect(() => validatePublicUrl('http://10.10.10.10')).toThrowError(DomainError);
      expect(() => validatePublicUrl('http://192.168.0.1')).toThrowError(DomainError);
    });

    it('rejects private IPv6 targets including translations', () => {
      expect(() => validatePublicUrl('http://[::1]')).toThrowError(DomainError);
      expect(() => validatePublicUrl('http://[fc00::1]')).toThrowError(DomainError);
      expect(() => validatePublicUrl('http://[64:ff9b::127.0.0.1]')).toThrowError(DomainError);
      expect(() => validatePublicUrl('http://[2002:c0a8:0101::1]')).toThrowError(DomainError);
    });

    it('rejects empty or malformed strings', () => {
      expect(() => validatePublicUrl('')).toThrowError(DomainError);
      expect(() => validatePublicUrl('not-a-valid-url')).toThrowError(DomainError);
    });
  });

  describe('assertPublicUrl with DNS Resolution (EC-03, VC-04)', () => {
    it('rejects DNS names resolving to loopback IP addresses (127.0.0.1.nip.io, localtest.me)', async () => {
      // EC-03: Hostnames resolving to loopback must be rejected before navigation
      await expect(assertPublicUrl('http://127.0.0.1.nip.io')).rejects.toThrowError(DomainError);
      await expect(assertPublicUrl('http://localhost.')).rejects.toThrowError(DomainError);
    });

    it('accepts public domains resolving to external IP addresses', async () => {
      const parsed = await assertPublicUrl('https://example.com');
      expect(parsed.hostname).toBe('example.com');
    });
  });

  describe('checkPublicUrl & validatePublicUrl compatibility pin', () => {
    it('handles valid public URLs', () => {
      const result = checkPublicUrl('https://example.com/test');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.url.href).toBe('https://example.com/test');
        expect(result.url.protocol).toBe('https:');
        expect(result.url.hostname).toBe('example.com');
      }
    });

    it('pins EMPTY rejection kind and exact legacy error string', () => {
      expect(checkPublicUrl('')).toEqual({ ok: false, reason: 'EMPTY' });
      expect(checkPublicUrl('   ')).toEqual({ ok: false, reason: 'EMPTY' });

      try {
        validatePublicUrl('');
        expect.unreachable();
      } catch (err) {
        expect(err).toBeInstanceOf(DomainError);
        expect((err as DomainError).code).toBe('BAD_REQUEST');
        expect((err as DomainError).message).toBe('Target URL must be a non-empty string');
      }
    });

    it('pins MALFORMED rejection kind and exact legacy error string', () => {
      const candidate = 'not-a-valid-url';
      expect(checkPublicUrl(candidate)).toEqual({ ok: false, reason: 'MALFORMED' });

      try {
        validatePublicUrl(candidate);
        expect.unreachable();
      } catch (err) {
        expect(err).toBeInstanceOf(DomainError);
        expect((err as DomainError).code).toBe('BAD_REQUEST');
        expect((err as DomainError).message).toBe(`Malformed URL provided: "${candidate}"`);
      }
    });

    it('pins PROTOCOL rejection kind and exact legacy error string', () => {
      const candidate = 'ftp://example.com/file';
      expect(checkPublicUrl(candidate)).toEqual({ ok: false, reason: 'PROTOCOL' });

      try {
        validatePublicUrl(candidate);
        expect.unreachable();
      } catch (err) {
        expect(err).toBeInstanceOf(DomainError);
        expect((err as DomainError).code).toBe('BAD_REQUEST');
        expect((err as DomainError).message).toBe(
          'Unsupported protocol: "ftp:". Only HTTP and HTTPS are permitted',
        );
      }
    });

    it('pins INTERNAL_HOST rejection kind and exact legacy error string', () => {
      const candidateLocal = 'http://localhost:3000';
      expect(checkPublicUrl(candidateLocal)).toEqual({ ok: false, reason: 'INTERNAL_HOST' });

      try {
        validatePublicUrl(candidateLocal);
        expect.unreachable();
      } catch (err) {
        expect(err).toBeInstanceOf(DomainError);
        expect((err as DomainError).code).toBe('BAD_REQUEST');
        expect((err as DomainError).message).toBe(
          'Access to internal or local hostname "localhost" is prohibited',
        );
      }
    });
  });
});
