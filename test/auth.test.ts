import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { apiKeyAuthMiddleware, extractApiKey, validateApiKey } from '../src/services/auth.js';

describe('API Key Authentication & Security Invariants', () => {
  describe('validateApiKey constant-time comparison', () => {
    it('returns true when validKeys is empty (optional auth disabled)', () => {
      expect(validateApiKey('any-key', [])).toBe(true);
      expect(validateApiKey('', [])).toBe(true);
    });

    it('returns false when providedKey is empty or whitespace', () => {
      expect(validateApiKey('', ['secret-key'])).toBe(false);
      expect(validateApiKey('   ', ['secret-key'])).toBe(false);
    });

    it('returns true when providedKey matches an authorized key', () => {
      expect(validateApiKey('secret-key-123', ['secret-key-123'])).toBe(true);
      expect(validateApiKey('  secret-key-123  ', ['secret-key-123'])).toBe(true);
    });

    it('returns false when providedKey does not match authorized keys', () => {
      expect(validateApiKey('wrong-key', ['secret-key-123'])).toBe(false);
      expect(validateApiKey('secret-key-12', ['secret-key-123'])).toBe(false);
      expect(validateApiKey('secret-key-1234', ['secret-key-123'])).toBe(false);
    });

    it('supports multi-token key rotation and validates against any valid key', () => {
      const activeKeys = ['old-key-v1', 'active-key-v2', 'next-key-v3'];
      expect(validateApiKey('old-key-v1', activeKeys)).toBe(true);
      expect(validateApiKey('active-key-v2', activeKeys)).toBe(true);
      expect(validateApiKey('next-key-v3', activeKeys)).toBe(true);
      expect(validateApiKey('expired-key-v0', activeKeys)).toBe(false);
    });
  });

  describe('extractApiKey credential extraction', () => {
    it('extracts token from standard Authorization Bearer header', () => {
      const headers = new Headers({ Authorization: 'Bearer my-secret-token' });
      expect(extractApiKey(headers)).toBe('my-secret-token');
    });

    it('extracts token case-insensitively from bearer header', () => {
      const headersLower = new Headers({ authorization: 'bearer my-secret-token' });
      expect(extractApiKey(headersLower)).toBe('my-secret-token');

      const headersUpper = new Headers({ AUTHORIZATION: 'BEARER my-secret-token' });
      expect(extractApiKey(headersUpper)).toBe('my-secret-token');
    });

    it('extracts token from direct Authorization header without Bearer prefix', () => {
      const headers = new Headers({ Authorization: 'my-direct-token' });
      expect(extractApiKey(headers)).toBe('my-direct-token');
    });

    it('extracts token from X-API-Key header', () => {
      const headers = new Headers({ 'X-API-Key': 'my-custom-api-key' });
      expect(extractApiKey(headers)).toBe('my-custom-api-key');
    });

    it('extracts token from plain object header records', () => {
      expect(extractApiKey({ authorization: 'Bearer record-token' })).toBe('record-token');
      expect(extractApiKey({ 'x-api-key': 'x-record-token' })).toBe('x-record-token');
    });

    it('returns undefined when Authorization header is Bearer only with empty token', () => {
      const headers = new Headers({ Authorization: 'Bearer   ' });
      expect(extractApiKey(headers)).toBeUndefined();
    });

    it('returns undefined when no authorization headers are present', () => {
      const headers = new Headers({ 'Content-Type': 'application/json' });
      expect(extractApiKey(headers)).toBeUndefined();
      expect(extractApiKey({})).toBeUndefined();
    });
  });

  describe('apiKeyAuthMiddleware Hono integration', () => {
    it('bypasses authentication when apiKeys is empty (optional auth)', async () => {
      const app = new Hono();
      app.use('/mcp', apiKeyAuthMiddleware({ apiKeys: [] }));
      app.post('/mcp', (c) => c.json({ status: 'ok' }));

      const res = await app.request('/mcp', { method: 'POST' });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ status: 'ok' });
    });

    it('bypasses authentication for OPTIONS preflight requests', async () => {
      const app = new Hono();
      app.use('/mcp', apiKeyAuthMiddleware({ apiKeys: ['secret-key'] }));
      app.options('/mcp', () => new Response(null, { status: 204 }));

      const res = await app.request('/mcp', { method: 'OPTIONS' });
      expect(res.status).toBe(204);
    });

    it('bypasses authentication for public /health probes even when configured', async () => {
      const app = new Hono();
      app.use('*', apiKeyAuthMiddleware({ apiKeys: ['secret-key'] }));
      app.get('/health', (c) => c.json({ status: 'healthy' }));

      const res = await app.request('/health', { method: 'GET' });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ status: 'healthy' });
    });

    it('returns 401 with JSON-RPC error format when request lacks auth credentials', async () => {
      const app = new Hono();
      app.use('/mcp', apiKeyAuthMiddleware({ apiKeys: ['secret-key'] }));
      app.post('/mcp', (c) => c.json({ status: 'ok' }));

      const res = await app.request('/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(401);
      expect(res.headers.get('WWW-Authenticate')).toContain('Bearer realm="mcp-web-research"');
      const body = await res.json();
      expect(body.jsonrpc).toBe('2.0');
      expect(body.error).toBeDefined();
      expect(body.error.code).toBe(-32001);
      expect(body.error.message).toContain('Unauthorized');
    });

    it('returns 401 when invalid token is supplied', async () => {
      const app = new Hono();
      app.use('/mcp', apiKeyAuthMiddleware({ apiKeys: ['secret-key'] }));
      app.post('/mcp', (c) => c.json({ status: 'ok' }));

      const res = await app.request('/mcp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer invalid-token',
        },
      });

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error.code).toBe(-32001);
    });

    it('permits request when valid Bearer token is provided', async () => {
      const app = new Hono();
      app.use('/mcp', apiKeyAuthMiddleware({ apiKeys: ['secret-key'] }));
      app.post('/mcp', (c) => c.json({ status: 'authorized' }));

      const res = await app.request('/mcp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer secret-key',
        },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ status: 'authorized' });
    });

    it('permits request when valid X-API-Key header is provided', async () => {
      const app = new Hono();
      app.use('/mcp', apiKeyAuthMiddleware({ apiKeys: ['secret-key'] }));
      app.post('/mcp', (c) => c.json({ status: 'authorized' }));

      const res = await app.request('/mcp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'secret-key',
        },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ status: 'authorized' });
    });
  });
});
