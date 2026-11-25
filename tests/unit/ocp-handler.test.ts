import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';

const mockOpenPodExecSession = vi.fn();
const mockOpenPodLogStream = vi.fn();

vi.mock('@/lib/ocp/ocp-client', () => ({
  openPodExecSession: (...args: any[]) => mockOpenPodExecSession(...args),
  openPodLogStream: (...args: any[]) => mockOpenPodLogStream(...args),
}));

import {
  clearActiveOcpHandlers,
  getActiveOcpExecSessions,
  getActiveOcpLogStreams,
  registerOcpHandlers,
} from '@/lib/socket/ocp-handler';

function createMockSocket(id = 'sock-1') {
  const socket = new EventEmitter() as any;
  socket.id = id;
  socket.connected = true;
  socket.data = { userId: 'u1', username: 'admin' };
  const emitted: Array<{ event: string; args: any[] }> = [];
  const origEmit = socket.emit.bind(socket);
  socket.emit = (event: string, ...args: any[]) => {
    emitted.push({ event, args });
    return origEmit(event, ...args);
  };
  socket.emitted = emitted;
  return socket;
}

describe('Socket.IO OCP Handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearActiveOcpHandlers();
  });

  afterEach(() => {
    clearActiveOcpHandlers();
  });

  it('handles ocp:exec lifecycle and cleans up on disconnect', async () => {
    const mockSession = {
      write: vi.fn(),
      resize: vi.fn(),
      close: vi.fn(),
    };

    mockOpenPodExecSession.mockImplementation(
      async (_c, _ns, _pod, _cont, _sh, _cols, _rows, cbs) => {
        cbs.onOpen?.();
        cbs.onData('sh-4.4$ ');
        return mockSession;
      }
    );

    const socket = createMockSocket();
    registerOcpHandlers(socket);

    socket.emit('ocp:exec:open', {
      clusterId: 'c1',
      namespace: 'brimo',
      podName: 'api-pod',
      cols: 120,
      rows: 30,
    });

    await vi.waitFor(() => {
      expect(getActiveOcpExecSessions().size).toBe(1);
    });

    socket.emit('ocp:exec:input', 'ls\n');
    expect(mockSession.write).toHaveBeenCalledWith('ls\n');

    socket.emit('ocp:exec:resize', 100, 40);
    expect(mockSession.resize).toHaveBeenCalledWith(100, 40);

    expect(socket.emitted.some((e: any) => e.event === 'ocp:exec:ready')).toBe(true);
    expect(
      socket.emitted.some(
        (e: any) => e.event === 'ocp:exec:output' && e.args[0] === 'sh-4.4$ '
      )
    ).toBe(true);

    socket.emit('disconnect');
    expect(mockSession.close).toHaveBeenCalled();
    expect(getActiveOcpExecSessions().size).toBe(0);
  });

  it('handles ocp:logs:subscribe and unsubscribe', async () => {
    const mockStream = { close: vi.fn() };
    mockOpenPodLogStream.mockImplementation(async (_c, _ns, _pod, _cont, _lines, cbs) => {
      cbs.onData('2026-11-25 log line 1\n');
      return mockStream;
    });

    const socket = createMockSocket('sock-2');
    registerOcpHandlers(socket);

    socket.emit('ocp:logs:subscribe', {
      clusterId: 'c1',
      namespace: 'brimo',
      podName: 'api-pod',
      tailLines: 100,
    });

    await vi.waitFor(() => {
      expect(getActiveOcpLogStreams().size).toBe(1);
    });

    expect(
      socket.emitted.some(
        (e: any) =>
          e.event === 'ocp:logs:data' &&
          e.args[0] === '2026-11-25 log line 1\n'
      )
    ).toBe(true);

    socket.emit('ocp:logs:unsubscribe');
    expect(mockStream.close).toHaveBeenCalled();
    expect(getActiveOcpLogStreams().size).toBe(0);
  });
});
