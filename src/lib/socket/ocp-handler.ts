import { AuthenticatedSocket } from './socket-server';
import {
  openPodExecSession,
  openPodLogStream,
  type PodExecSession,
  type PodLogStreamHandle,
} from '../ocp/ocp-client';

export interface OcpExecOpenPayload {
  clusterId: string;
  namespace: string;
  podName: string;
  container?: string;
  shell?: '/bin/sh' | '/bin/bash';
  cols?: number;
  rows?: number;
}

export interface OcpLogsSubscribePayload {
  clusterId: string;
  namespace: string;
  podName: string;
  container?: string;
  tailLines?: number;
}

const activeExecSessions = new Map<string, PodExecSession>();
const activeLogStreams = new Map<string, PodLogStreamHandle>();

function cleanupExecSession(socketId: string): void {
  const session = activeExecSessions.get(socketId);
  if (session) {
    try {
      session.close();
    } catch {
      // Ignore cleanup errors
    }
    activeExecSessions.delete(socketId);
  }
}

function cleanupLogStream(socketId: string): void {
  const stream = activeLogStreams.get(socketId);
  if (stream) {
    try {
      stream.close();
    } catch {
      // Ignore cleanup errors
    }
    activeLogStreams.delete(socketId);
  }
}

/**
 * Registers Socket.IO event handlers for OpenShift Pod Exec and Live Pod Logs.
 */
export function registerOcpHandlers(socket: AuthenticatedSocket): void {
  socket.on('ocp:exec:open', async (payload: OcpExecOpenPayload) => {
    cleanupExecSession(socket.id);

    if (!payload?.clusterId || !payload?.namespace || !payload?.podName) {
      socket.emit('ocp:exec:error', 'clusterId, namespace, and podName are required');
      return;
    }

    try {
      const session = await openPodExecSession(
        payload.clusterId,
        payload.namespace,
        payload.podName,
        payload.container,
        payload.shell === '/bin/bash' ? '/bin/bash' : '/bin/sh',
        payload.cols || 80,
        payload.rows || 24,
        {
          onOpen: () => {
            socket.emit('ocp:exec:ready');
          },
          onData: (data: string) => {
            socket.emit('ocp:exec:output', data);
          },
          onError: (message: string) => {
            socket.emit('ocp:exec:error', message);
          },
          onClose: () => {
            activeExecSessions.delete(socket.id);
            socket.emit('ocp:exec:close');
          },
        }
      );

      if (!socket.connected) {
        session.close();
        return;
      }

      activeExecSessions.set(socket.id, session);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to open pod exec session';
      socket.emit('ocp:exec:error', msg);
    }
  });

  socket.on('ocp:exec:input', (data: string) => {
    const session = activeExecSessions.get(socket.id);
    if (session && typeof data === 'string') {
      session.write(data);
    }
  });

  socket.on('ocp:exec:resize', (cols: number, rows: number) => {
    const session = activeExecSessions.get(socket.id);
    if (session) {
      session.resize(cols, rows);
    }
  });

  socket.on('ocp:exec:close', () => {
    cleanupExecSession(socket.id);
    socket.emit('ocp:exec:close');
  });

  socket.on('ocp:logs:subscribe', async (payload: OcpLogsSubscribePayload) => {
    cleanupLogStream(socket.id);

    if (!payload?.clusterId || !payload?.namespace || !payload?.podName) {
      socket.emit('ocp:logs:error', 'clusterId, namespace, and podName are required');
      return;
    }

    try {
      const stream = await openPodLogStream(
        payload.clusterId,
        payload.namespace,
        payload.podName,
        payload.container,
        payload.tailLines || 200,
        {
          onData: (chunk: string) => {
            socket.emit('ocp:logs:data', chunk);
          },
          onError: (message: string) => {
            socket.emit('ocp:logs:error', message);
          },
          onClose: () => {
            activeLogStreams.delete(socket.id);
            socket.emit('ocp:logs:close');
          },
        }
      );

      if (!socket.connected) {
        stream.close();
        return;
      }

      activeLogStreams.set(socket.id, stream);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to stream pod logs';
      socket.emit('ocp:logs:error', msg);
    }
  });

  socket.on('ocp:logs:unsubscribe', () => {
    cleanupLogStream(socket.id);
  });

  socket.on('disconnect', () => {
    cleanupExecSession(socket.id);
    cleanupLogStream(socket.id);
  });
}

export function getActiveOcpExecSessions(): Map<string, PodExecSession> {
  return activeExecSessions;
}

export function getActiveOcpLogStreams(): Map<string, PodLogStreamHandle> {
  return activeLogStreams;
}

export function clearActiveOcpHandlers(): void {
  for (const socketId of Array.from(activeExecSessions.keys())) {
    cleanupExecSession(socketId);
  }
  for (const socketId of Array.from(activeLogStreams.keys())) {
    cleanupLogStream(socketId);
  }
  activeExecSessions.clear();
  activeLogStreams.clear();
}
