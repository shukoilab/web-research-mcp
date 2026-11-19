import { DomainError } from '@shukoi/core';
import { describe, expect, it } from 'vitest';
import { isPrivateIpv4, isPrivateIpv6, validatePublicUrl } from '../src/services/ssrf.js';

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
    });

    it('identifies public IPv4 addresses as non-private', () => {
      expect(isPrivateIpv4('8.8.8.8')).toBe(false);
      expect(isPrivateIpv4('1.1.1.1')).toBe(false);
      expect(isPrivateIpv4('142.250.190.46')).toBe(false);
    });
  });

  describe('isPrivateIpv6', () => {
    it('identifies private and loopback IPv6 addresses', () => {
      expect(isPrivateIpv6('::1')).toBe(true);
      expect(isPrivateIpv6('[::1]')).toBe(true);
      expect(isPrivateIpv6('fc00::1')).toBe(true);
      expect(isPrivateIpv6('fe80::1')).toBe(true);
      expect(isPrivateIpv6('::ffff:127.0.0.1')).toBe(true);
      expect(isPrivateIpv6('::ffff:192.168.0.1')).toBe(true);
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

    it('rejects localhost and internal hostnames', () => {
      expect(() => validatePublicUrl('http://localhost:3000')).toThrowError(DomainError);
      expect(() => validatePublicUrl('http://app.localhost')).toThrowError(DomainError);
      expect(() => validatePublicUrl('http://myhost.local')).toThrowError(DomainError);
      expect(() => validatePublicUrl('http://metadata.google.internal')).toThrowError(DomainError);
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

    it('rejects private IPv6 targets', () => {
      expect(() => validatePublicUrl('http://[::1]')).toThrowError(DomainError);
      expect(() => validatePublicUrl('http://[fc00::1]')).toThrowError(DomainError);
    });

    it('rejects empty or malformed strings', () => {
      expect(() => validatePublicUrl('')).toThrowError(DomainError);
      expect(() => validatePublicUrl('not-a-valid-url')).toThrowError(DomainError);
    });
  });
});
