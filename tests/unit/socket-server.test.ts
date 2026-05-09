import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createServer, Server as HTTPServer } from 'http';

// Mock next-auth/jwt
vi.mock('next-auth/jwt', () => ({
  decode: vi.fn(),
}));

import { decode } from 'next-auth/jwt';
import {
  initSocketServer,
  getIO,
  resetSocketServer,
} from '@/lib/socket/socket-server';

describe('Socket.IO Server', () => {
  let httpServer: HTTPServer;

  beforeEach(() => {
    // Set required env vars
    process.env.NEXTAUTH_SECRET = 'test-secret-for-socket-io';
    process.env.NEXTAUTH_URL = 'http://localhost:3000';
    httpServer = createServer();
  });

  afterEach(() => {
    resetSocketServer();
    httpServer.close();
    delete process.env.NEXTAUTH_SECRET;
    delete process.env.NEXTAUTH_URL;
  });

  describe('initSocketServer', () => {
    it('should create a Socket.IO server instance', () => {
      const io = initSocketServer(httpServer);
      expect(io).toBeDefined();
      expect(io.path()).toBe('/api/socketio');
    });

    it('should return the same instance on subsequent calls', () => {
      const io1 = initSocketServer(httpServer);
      const io2 = initSocketServer(httpServer);
      expect(io1).toBe(io2);
    });
  });

  describe('getIO', () => {
    it('should throw if server is not initialized', () => {
      expect(() => getIO()).toThrow(
        'Socket.IO server has not been initialized'
      );
    });

    it('should return the server instance after initialization', () => {
      const io = initSocketServer(httpServer);
      expect(getIO()).toBe(io);
    });
  });

  describe('resetSocketServer', () => {
    it('should reset the server instance', () => {
      initSocketServer(httpServer);
      resetSocketServer();
      expect(() => getIO()).toThrow(
        'Socket.IO server has not been initialized'
      );
    });
  });

  describe('authentication middleware', () => {
    it('should reject connections without cookies', async () => {
      const io = initSocketServer(httpServer);

      // Get the middleware function from the io server
      // Socket.IO stores middleware in _fns array on the namespace
      const middleware = (io as any)._fns || (io.of('/') as any)._fns;
      expect(middleware).toBeDefined();
      expect(middleware.length).toBeGreaterThan(0);

      const authMiddleware = middleware[0];

      // Simulate a socket with no cookies
      const mockSocket = {
        handshake: {
          headers: {},
        },
        data: {},
      };

      const next = vi.fn();
      await authMiddleware(mockSocket, next);

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('no cookies'),
        })
      );
    });

    it('should reject connections without session token', async () => {
      const io = initSocketServer(httpServer);
      const middleware = (io as any)._fns || (io.of('/') as any)._fns;
      const authMiddleware = middleware[0];

      const mockSocket = {
        handshake: {
          headers: {
            cookie: 'other-cookie=value',
          },
        },
        data: {},
      };

      const next = vi.fn();
      await authMiddleware(mockSocket, next);

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('no session token'),
        })
      );
    });

    it('should reject connections with invalid JWT', async () => {
      vi.mocked(decode).mockResolvedValue(null);

      const io = initSocketServer(httpServer);
      const middleware = (io as any)._fns || (io.of('/') as any)._fns;
      const authMiddleware = middleware[0];

      const mockSocket = {
        handshake: {
          headers: {
            cookie: 'next-auth.session-token=invalid-token',
          },
        },
        data: {},
      };

      const next = vi.fn();
      await authMiddleware(mockSocket, next);

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('invalid session'),
        })
      );
    });

    it('should accept connections with valid JWT and attach user data', async () => {
      vi.mocked(decode).mockResolvedValue({
        id: 'user-123',
        username: 'admin',
        name: 'admin',
        iat: Date.now(),
        exp: Date.now() + 1800,
      });

      const io = initSocketServer(httpServer);
      const middleware = (io as any)._fns || (io.of('/') as any)._fns;
      const authMiddleware = middleware[0];

      const mockSocket = {
        handshake: {
          headers: {
            cookie: 'next-auth.session-token=valid-token',
          },
        },
        data: {} as Record<string, unknown>,
      };

      const next = vi.fn();
      await authMiddleware(mockSocket, next);

      expect(next).toHaveBeenCalledWith();
      expect(mockSocket.data).toEqual({
        userId: 'user-123',
        username: 'admin',
      });
    });

    it('should accept connections with secure cookie prefix', async () => {
      vi.mocked(decode).mockResolvedValue({
        id: 'user-456',
        username: 'testuser',
        name: 'testuser',
        iat: Date.now(),
        exp: Date.now() + 1800,
      });

      const io = initSocketServer(httpServer);
      const middleware = (io as any)._fns || (io.of('/') as any)._fns;
      const authMiddleware = middleware[0];

      const mockSocket = {
        handshake: {
          headers: {
            cookie: '__Secure-next-auth.session-token=secure-token',
          },
        },
        data: {} as Record<string, unknown>,
      };

      const next = vi.fn();
      await authMiddleware(mockSocket, next);

      expect(next).toHaveBeenCalledWith();
      expect(mockSocket.data).toEqual({
        userId: 'user-456',
        username: 'testuser',
      });
    });

    it('should reject when NEXTAUTH_SECRET is missing', async () => {
      delete process.env.NEXTAUTH_SECRET;

      const io = initSocketServer(httpServer);
      const middleware = (io as any)._fns || (io.of('/') as any)._fns;
      const authMiddleware = middleware[0];

      const mockSocket = {
        handshake: {
          headers: {
            cookie: 'next-auth.session-token=some-token',
          },
        },
        data: {},
      };

      const next = vi.fn();
      await authMiddleware(mockSocket, next);

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('missing secret'),
        })
      );
    });
  });
});
