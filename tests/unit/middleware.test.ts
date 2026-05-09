import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Mock next-auth/jwt
vi.mock('next-auth/jwt', () => ({
  getToken: vi.fn(),
}));

import { getToken } from 'next-auth/jwt';
import { middleware, config } from '@/middleware';

const mockedGetToken = vi.mocked(getToken);

function createRequest(url: string): NextRequest {
  return new NextRequest(new URL(url, 'http://localhost:3000'));
}

describe('Auth Middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('unauthenticated users', () => {
    beforeEach(() => {
      mockedGetToken.mockResolvedValue(null);
    });

    it('should redirect unauthenticated users to /login', async () => {
      const request = createRequest('/');
      const response = await middleware(request);

      expect(response.status).toBe(307);
      const redirectUrl = new URL(response.headers.get('location')!);
      expect(redirectUrl.pathname).toBe('/login');
    });

    it('should include callbackUrl when redirecting to login', async () => {
      const request = createRequest('/dashboard/vms');
      const response = await middleware(request);

      expect(response.status).toBe(307);
      const redirectUrl = new URL(response.headers.get('location')!);
      expect(redirectUrl.pathname).toBe('/login');
      expect(redirectUrl.searchParams.get('callbackUrl')).toBe('/dashboard/vms');
    });

    it('should allow access to /login page', async () => {
      const request = createRequest('/login');
      const response = await middleware(request);

      expect(response.status).toBe(200);
    });

    it('should allow access to /api/auth routes', async () => {
      const request = createRequest('/api/auth/signin');
      const response = await middleware(request);

      expect(response.status).toBe(200);
    });

    it('should allow access to /api/auth/callback routes', async () => {
      const request = createRequest('/api/auth/callback/credentials');
      const response = await middleware(request);

      expect(response.status).toBe(200);
    });
  });

  describe('authenticated users', () => {
    beforeEach(() => {
      mockedGetToken.mockResolvedValue({
        id: 'user-1',
        username: 'admin',
        exp: Math.floor(Date.now() / 1000) + 1800,
        iat: Math.floor(Date.now() / 1000),
        jti: 'test-jti',
      });
    });

    it('should allow authenticated users to access protected routes', async () => {
      const request = createRequest('/');
      const response = await middleware(request);

      expect(response.status).toBe(200);
    });

    it('should redirect authenticated users away from /login', async () => {
      const request = createRequest('/login');
      const response = await middleware(request);

      expect(response.status).toBe(307);
      const redirectUrl = new URL(response.headers.get('location')!);
      expect(redirectUrl.pathname).toBe('/');
    });

    it('should allow authenticated users to access API routes', async () => {
      const request = createRequest('/api/vms');
      const response = await middleware(request);

      expect(response.status).toBe(200);
    });
  });

  describe('matcher configuration', () => {
    it('should have a matcher that excludes static assets', () => {
      expect(config.matcher).toBeDefined();
      expect(config.matcher).toHaveLength(1);

      const matcherPattern = config.matcher[0];
      // The pattern should exclude _next/static, _next/image, and favicon.ico
      expect(matcherPattern).toContain('_next/static');
      expect(matcherPattern).toContain('_next/image');
      expect(matcherPattern).toContain('favicon.ico');
    });
  });
});
