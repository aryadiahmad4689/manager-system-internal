import { Server as HTTPServer } from 'http';
import { Server, Socket } from 'socket.io';
import { decode } from 'next-auth/jwt';
import { parse as parseCookie } from 'cookie';
import { registerTerminalHandlers } from './terminal-handler';
import { registerLogHandlers } from './log-handler';

/**
 * Socket.IO event interfaces for type-safe communication.
 */
export interface ServerToClientEvents {
  'terminal:output': (data: string) => void;
  'terminal:error': (error: string) => void;
  'terminal:close': () => void;
  'log:newEntry': (entry: LogEntry) => void;
  'vm:statusChange': (status: VMStatus) => void;
}

export interface ClientToServerEvents {
  'terminal:open': (vmId: string) => void;
  'terminal:input': (data: string) => void;
  'terminal:resize': (cols: number, rows: number) => void;
  'terminal:close': () => void;
  'log:subscribe': (vmId: string, project: string, filename: string) => void;
  'log:unsubscribe': () => void;
}

export interface LogEntry {
  level: 'ERROR' | 'DEBUG' | 'INFO' | 'ALL';
  timestamp: string;
  message: string;
  raw: string;
}

export interface VMStatus {
  vmId: string;
  status: 'online' | 'offline' | 'unreachable';
  lastChecked: Date;
  failCount: number;
}

/**
 * Extended socket interface with authenticated user data.
 */
export interface AuthenticatedSocket extends Socket<ClientToServerEvents, ServerToClientEvents> {
  data: {
    userId: string;
    username: string;
  };
}

/**
 * Typed Socket.IO server instance.
 */
export type IOServer = Server<ClientToServerEvents, ServerToClientEvents>;

/**
 * Singleton Socket.IO server instance.
 */
let io: IOServer | null = null;

/**
 * Returns the Socket.IO server instance.
 * Throws if the server has not been initialized yet.
 */
export function getIO(): IOServer {
  if (!io) {
    throw new Error('Socket.IO server has not been initialized. Call initSocketServer() first.');
  }
  return io;
}

/**
 * Initializes the Socket.IO server and attaches it to the given HTTP server.
 * Sets up authentication middleware to validate NextAuth.js JWT sessions.
 */
export function initSocketServer(httpServer: HTTPServer): IOServer {
  if (io) {
    return io;
  }

  io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
    path: '/api/socketio',
    addTrailingSlash: false,
    serveClient: false,
    allowUpgrades: true,
    transports: ['websocket', 'polling'],
    cors: {
      origin: process.env.NEXTAUTH_URL || 'http://localhost:3000',
      credentials: true,
    },
  });

  // Authentication middleware: validate NextAuth.js JWT from cookies
  io.use(async (socket, next) => {
    try {
      const cookieHeader = socket.handshake.headers.cookie;

      if (!cookieHeader) {
        return next(new Error('Authentication required: no cookies provided'));
      }

      const cookies = parseCookie(cookieHeader);

      // NextAuth.js stores the session token in different cookie names
      // depending on whether the app uses HTTPS (secure prefix) or not
      const sessionToken =
        cookies['__Secure-next-auth.session-token'] ||
        cookies['next-auth.session-token'];

      if (!sessionToken) {
        return next(new Error('Authentication required: no session token'));
      }

      const secret = process.env.NEXTAUTH_SECRET;
      if (!secret) {
        return next(new Error('Server configuration error: missing secret'));
      }

      // Decode and verify the JWT token
      const decoded = await decode({
        token: sessionToken,
        secret,
      });

      if (!decoded || !decoded.id) {
        return next(new Error('Authentication failed: invalid session'));
      }

      // Attach user data to the socket for use in event handlers
      socket.data = {
        userId: decoded.id as string,
        username: (decoded.username || decoded.name) as string,
      };

      next();
    } catch (error) {
      next(new Error('Authentication failed: could not verify session'));
    }
  });

  // Log connections and register event handlers
  io.on('connection', (socket) => {
    const authSocket = socket as AuthenticatedSocket;
    console.log(
      `[Socket.IO] Client connected: ${authSocket.id} (user: ${authSocket.data.username})`
    );

    // Register terminal event handlers
    registerTerminalHandlers(authSocket);

    // Register log streaming event handlers
    registerLogHandlers(authSocket);

    socket.on('disconnect', (reason) => {
      console.log(
        `[Socket.IO] Client disconnected: ${authSocket.id} (reason: ${reason})`
      );
    });
  });

  console.log('[Socket.IO] Server initialized');
  return io;
}

/**
 * Resets the Socket.IO server instance (useful for testing).
 */
export function resetSocketServer(): void {
  if (io) {
    io.close();
    io = null;
  }
}

/**
 * Creates a Socket.IO server in "noServer" mode for use with custom upgrade handling.
 * This avoids conflicts with Next.js dev server's WebSocket handling.
 */
export function setupSocketIO(): IOServer {
  if (io) {
    return io;
  }

  io = new Server<ClientToServerEvents, ServerToClientEvents>({
    path: '/api/socketio',
    addTrailingSlash: false,
    serveClient: false,
    allowUpgrades: true,
    transports: ['websocket', 'polling'],
    cors: {
      origin: process.env.NEXTAUTH_URL || 'http://localhost:3000',
      credentials: true,
    },
  });

  // Authentication middleware: validate NextAuth.js JWT from cookies
  io.use(async (socket, next) => {
    try {
      const cookieHeader = socket.handshake.headers.cookie;

      if (!cookieHeader) {
        return next(new Error('Authentication required: no cookies provided'));
      }

      const cookies = parseCookie(cookieHeader);

      const sessionToken =
        cookies['__Secure-next-auth.session-token'] ||
        cookies['next-auth.session-token'];

      if (!sessionToken) {
        return next(new Error('Authentication required: no session token'));
      }

      const secret = process.env.NEXTAUTH_SECRET;
      if (!secret) {
        return next(new Error('Server configuration error: missing secret'));
      }

      const decoded = await decode({
        token: sessionToken,
        secret,
      });

      if (!decoded || !decoded.id) {
        return next(new Error('Authentication failed: invalid session'));
      }

      socket.data = {
        userId: decoded.id as string,
        username: (decoded.username || decoded.name) as string,
      };

      next();
    } catch (error) {
      next(new Error('Authentication failed: could not verify session'));
    }
  });

  // Log connections and register event handlers
  io.on('connection', (socket) => {
    const authSocket = socket as AuthenticatedSocket;
    console.log(
      `[Socket.IO] Client connected: ${authSocket.id} (user: ${authSocket.data.username})`
    );

    registerTerminalHandlers(authSocket);
    registerLogHandlers(authSocket);

    socket.on('disconnect', (reason) => {
      console.log(
        `[Socket.IO] Client disconnected: ${authSocket.id} (reason: ${reason})`
      );
    });
  });

  console.log('[Socket.IO] Server initialized (noServer mode)');
  return io;
}
