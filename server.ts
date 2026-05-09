import { createServer } from 'http';
import { parse } from 'url';
import next from 'next';
import { Server } from 'socket.io';
import { decode } from 'next-auth/jwt';
import { parse as parseCookie } from 'cookie';

const dev = process.env.NODE_ENV !== 'production';
const hostname = '0.0.0.0';
const port = parseInt(process.env.PORT || '3000', 10);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  // Create HTTP server — DO NOT handle requests in createServer callback
  // because engine.io needs to intercept Socket.IO requests first via its own listener
  const httpServer = createServer();

  // Create Socket.IO server - engine.io will attach request + upgrade listeners to httpServer
  // Engine.io removes all existing 'request' listeners, adds its own that intercepts /api/socketio,
  // and forwards everything else to the original listeners.
  const io = new Server(httpServer, {
    path: '/api/socketio',
    addTrailingSlash: false,
    serveClient: false,
    transports: ['websocket', 'polling'],
    pingTimeout: 60000,
    pingInterval: 25000,
    cors: {
      origin: process.env.NEXTAUTH_URL || 'http://localhost:3000',
      credentials: true,
    },
    destroyUpgrade: false,
  });

  // Add Next.js request handler AFTER Socket.IO is attached
  // Engine.io already re-ordered listeners so it intercepts /api/socketio first
  httpServer.on('request', (req, res) => {
    // Skip Socket.IO paths — engine.io handles these
    if (req.url?.startsWith('/api/socketio')) {
      return;
    }
    const parsedUrl = parse(req.url!, true);
    handle(req, res, parsedUrl);
  });

  // Auth middleware
  io.use(async (socket, next) => {
    try {
      const cookieHeader = socket.handshake.headers.cookie;
      if (!cookieHeader) return next(new Error('No cookies'));

      const cookies = parseCookie(cookieHeader);
      const sessionToken =
        cookies['__Secure-next-auth.session-token'] ||
        cookies['next-auth.session-token'];

      if (!sessionToken) return next(new Error('No session token'));

      const secret = process.env.NEXTAUTH_SECRET;
      if (!secret) return next(new Error('Missing secret'));

      const decoded = await decode({ token: sessionToken, secret });
      if (!decoded || !decoded.id) return next(new Error('Invalid session'));

      socket.data = {
        userId: decoded.id as string,
        username: (decoded.username || decoded.name) as string,
      };
      next();
    } catch {
      next(new Error('Auth failed'));
    }
  });

  // Connection handler
  io.on('connection', async (socket) => {
    const { registerTerminalHandlers } = await import('./src/lib/socket/terminal-handler');
    const { registerLogHandlers } = await import('./src/lib/socket/log-handler');

    console.log(`[Socket.IO] Connected: ${socket.id} (user: ${socket.data.username})`);
    registerTerminalHandlers(socket as any);
    registerLogHandlers(socket as any);

    socket.on('disconnect', (reason) => {
      console.log(`[Socket.IO] Disconnected: ${socket.id} (reason: ${reason})`);
    });
  });

  // CRITICAL: Prevent Next.js dev server from adding its own upgrade handler
  // that conflicts with Socket.IO. Next.js calls setupWebSocketHandler() lazily
  // on the first request, which adds an upgrade listener that tries to handle
  // ALL upgrade requests (including Socket.IO's) and crashes.
  //
  // We intercept httpServer.on('upgrade', ...) calls to wrap any handler added
  // after Socket.IO, filtering out Socket.IO paths.
  const originalOn = httpServer.on.bind(httpServer);
  httpServer.on = function (event: string, handler: (...args: any[]) => void) {
    if (event === 'upgrade') {
      // Wrap the upgrade handler to skip Socket.IO paths
      const wrappedHandler = (req: any, socket: any, head: any) => {
        if (req.url?.startsWith('/api/socketio')) {
          // Already handled by engine.io's upgrade listener - do nothing
          return;
        }
        handler(req, socket, head);
      };
      return originalOn(event, wrappedHandler);
    }
    return originalOn(event, handler);
  } as any;

  httpServer.listen(port, () => {
    console.log(`> Ready on http://${hostname}:${port}`);
    console.log(`> Socket.IO at /api/socketio (websocket + polling)`);
    console.log(`> Environment: ${dev ? 'development' : 'production'}`);
  });
});
