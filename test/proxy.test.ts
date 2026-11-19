import { describe, expect, it } from 'vitest';
import { parseProxyConfig } from '../src/config.js';

describe('Proxy Configuration Parser', () => {
  it('returns undefined for empty, whitespace, or undefined inputs', () => {
    expect(parseProxyConfig()).toBeUndefined();
    expect(parseProxyConfig('')).toBeUndefined();
    expect(parseProxyConfig('   ')).toBeUndefined();
  });

  it('parses unauthenticated HTTP proxy URLs correctly', () => {
    const parsed = parseProxyConfig('http://proxy.example.com:8080');
    expect(parsed).toEqual({
      server: 'http://proxy.example.com:8080',
      username: undefined,
      password: undefined,
    });
  });

  it('parses authenticated HTTP proxy with username and password', () => {
    const parsed = parseProxyConfig('http://testuser:testpass@proxy.example.com:8080');
    expect(parsed).toEqual({
      server: 'http://proxy.example.com:8080',
      username: 'testuser',
      password: 'testpass',
    });
  });

  it('parses authenticated HTTPS proxy with URL-encoded special characters', () => {
    const parsed = parseProxyConfig('https://user%40test:p%40ssw0rd@proxy.corp.internal:8443');
    expect(parsed).toEqual({
      server: 'https://proxy.corp.internal:8443',
      username: 'user@test',
      password: 'p@ssw0rd',
    });
  });
});
