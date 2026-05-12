import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SSHShellStream } from '@/lib/ssh/ssh-manager';

// Mock the SSH manager module
vi.mock('@/lib/ssh/ssh-manager', () => ({
  getSSHManager: vi.fn(),
}));

// Mock the SSH error handler module
vi.mock('@/lib/ssh/ssh-error-handler', () => ({
  handleSSHError: vi.fn(),
}));

import { getSSHManager } from '@/lib/ssh/ssh-manager';
import { handleSSHError } from '@/lib/ssh/ssh-error-handler';
import {
  registerTerminalHandlers,
  getActiveSessions,
  clearActiveSessions,
} from '@/lib/socket/terminal-handler';

/**
 * Creates a mock AuthenticatedSocket for testing.
 */
function createMockSocket() {
  const listeners = new Map<string, Function[]>();

  const socket = {
    id: 'test-socket-id',
    data: { userId: 'user-1', username: 'admin' },
    on: vi.fn((event: string, handler: Function) => {
      if (!listeners.has(event)) {
        listeners.set(event, []);
      }
      listeners.get(event)!.push(handler);
    }),
    emit: vi.fn(),
    // Helper to trigger registered event handlers
    _trigger: async (event: string, ...args: any[]) => {
      const handlers = listeners.get(event) || [];
      for (const handler of handlers) {
        await handler(...args);
      }
    },
  };

  return socket;
}

/**
 * Creates a mock SSHShellStream for testing.
 */
function createMockShell(): SSHShellStream & {
  _dataCallback: ((data: string) => void) | null;
  _closeCallback: (() => void) | null;
} {
  let dataCallback: ((data: string) => void) | null = null;
  let closeCallback: (() => void) | null = null;

  return {
    write: vi.fn(),
    onData: vi.fn((cb: (data: string) => void) => {
      dataCallback = cb;
    }),
    onClose: vi.fn((cb: () => void) => {
      closeCallback = cb;
    }),
    resize: vi.fn(),
    close: vi.fn(),
    get _dataCallback() {
      return dataCallback;
    },
    get _closeCallback() {
      return closeCallback;
    },
  };
}

describe('Terminal Handler', () => {
  let mockSocket: ReturnType<typeof createMockSocket>;
  let mockShell: ReturnType<typeof createMockShell>;
  let mockSSHManager: { openShell: ReturnType<typeof vi.fn>; executeCommand: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    mockSocket = createMockSocket();
    mockShell = createMockShell();
    mockSSHManager = {
      openShell: vi.fn().mockResolvedValue(mockShell),
      executeCommand: vi.fn().mockResolvedValue(''),
    };

    vi.mocked(getSSHManager).mockReturnValue(mockSSHManager as any);
    vi.mocked(handleSSHError).mockReturnValue({
      type: 'unknown',
      message: 'Terjadi kesalahan koneksi. Silakan coba lagi.',
      action: 'none',
      retryable: false,
    });
  });

  afterEach(() => {
    clearActiveSessions();
    vi.clearAllMocks();
  });

  describe('registerTerminalHandlers', () => {
    it('should register all terminal event handlers', () => {
      registerTerminalHandlers(mockSocket as any);

      expect(mockSocket.on).toHaveBeenCalledWith('terminal:open', expect.any(Function));
      expect(mockSocket.on).toHaveBeenCalledWith('terminal:input', expect.any(Function));
      expect(mockSocket.on).toHaveBeenCalledWith('terminal:resize', expect.any(Function));
      expect(mockSocket.on).toHaveBeenCalledWith('terminal:close', expect.any(Function));
      expect(mockSocket.on).toHaveBeenCalledWith('terminal:check-git', expect.any(Function));
      expect(mockSocket.on).toHaveBeenCalledWith('disconnect', expect.any(Function));
    });
  });

  describe('terminal:open', () => {
    it('should open an SSH shell session and track it', async () => {
      registerTerminalHandlers(mockSocket as any);

      await mockSocket._trigger('terminal:open', 'vm-123');

      expect(mockSSHManager.openShell).toHaveBeenCalledWith('vm-123', 80, 24);
      expect(mockShell.onData).toHaveBeenCalledWith(expect.any(Function));
      expect(mockShell.onClose).toHaveBeenCalledWith(expect.any(Function));

      const sessions = getActiveSessions();
      expect(sessions.has('test-socket-id')).toBe(true);
      expect(sessions.get('test-socket-id')!.vmId).toBe('vm-123');
    });

    it('should forward SSH output to client via terminal:output', async () => {
      registerTerminalHandlers(mockSocket as any);

      await mockSocket._trigger('terminal:open', 'vm-123');

      // Simulate SSH output
      mockShell._dataCallback!('hello world');

      expect(mockSocket.emit).toHaveBeenCalledWith('terminal:output', 'hello world');
    });

    it('should emit terminal:close when shell closes', async () => {
      registerTerminalHandlers(mockSocket as any);

      await mockSocket._trigger('terminal:open', 'vm-123');

      // Simulate shell close
      mockShell._closeCallback!();

      expect(mockSocket.emit).toHaveBeenCalledWith('terminal:close');
      expect(getActiveSessions().has('test-socket-id')).toBe(false);
    });

    it('should emit terminal:error on SSH connection failure', async () => {
      const sshError = new Error('Connection timeout');
      mockSSHManager.openShell.mockRejectedValue(sshError);
      vi.mocked(handleSSHError).mockReturnValue({
        type: 'timeout',
        message: 'Koneksi ke VM timeout. Periksa apakah VM aktif.',
        action: 'retry',
        retryable: true,
      });

      registerTerminalHandlers(mockSocket as any);

      await mockSocket._trigger('terminal:open', 'vm-123');

      expect(handleSSHError).toHaveBeenCalledWith(sshError);
      expect(mockSocket.emit).toHaveBeenCalledWith(
        'terminal:error',
        'Koneksi ke VM timeout. Periksa apakah VM aktif.'
      );
    });

    it('should close existing session before opening a new one', async () => {
      registerTerminalHandlers(mockSocket as any);

      // Open first session
      await mockSocket._trigger('terminal:open', 'vm-111');
      const firstShell = mockShell;

      // Create a new mock shell for the second session
      const secondShell = createMockShell();
      mockSSHManager.openShell.mockResolvedValue(secondShell);

      // Open second session
      await mockSocket._trigger('terminal:open', 'vm-222');

      expect(firstShell.close).toHaveBeenCalled();
      const sessions = getActiveSessions();
      expect(sessions.get('test-socket-id')!.vmId).toBe('vm-222');
    });

    it('should accept initial size parameters', async () => {
      registerTerminalHandlers(mockSocket as any);

      await mockSocket._trigger('terminal:open', 'vm-123', { cols: 120, rows: 40 });

      expect(mockSSHManager.openShell).toHaveBeenCalledWith('vm-123', 120, 40);
    });
  });

  describe('terminal:input', () => {
    it('should write data to the SSH shell stream', async () => {
      registerTerminalHandlers(mockSocket as any);
      await mockSocket._trigger('terminal:open', 'vm-123');

      await mockSocket._trigger('terminal:input', 'ls -la\n');

      expect(mockShell.write).toHaveBeenCalledWith('ls -la\n');
    });

    it('should do nothing if no active session exists', async () => {
      registerTerminalHandlers(mockSocket as any);

      await mockSocket._trigger('terminal:input', 'ls -la\n');

      expect(mockShell.write).not.toHaveBeenCalled();
    });

    it('should emit terminal:error if write fails', async () => {
      registerTerminalHandlers(mockSocket as any);
      await mockSocket._trigger('terminal:open', 'vm-123');

      mockShell.write.mockImplementation(() => {
        throw new Error('Stream closed');
      });

      await mockSocket._trigger('terminal:input', 'data');

      expect(handleSSHError).toHaveBeenCalled();
      expect(mockSocket.emit).toHaveBeenCalledWith(
        'terminal:error',
        'Terjadi kesalahan koneksi. Silakan coba lagi.'
      );
    });
  });

  describe('terminal:resize', () => {
    it('should resize the PTY dimensions', async () => {
      registerTerminalHandlers(mockSocket as any);
      await mockSocket._trigger('terminal:open', 'vm-123');

      await mockSocket._trigger('terminal:resize', 120, 40);

      expect(mockShell.resize).toHaveBeenCalledWith(120, 40);
    });

    it('should do nothing if no active session exists', async () => {
      registerTerminalHandlers(mockSocket as any);

      await mockSocket._trigger('terminal:resize', 120, 40);

      expect(mockShell.resize).not.toHaveBeenCalled();
    });

    it('should emit terminal:error if resize fails', async () => {
      registerTerminalHandlers(mockSocket as any);
      await mockSocket._trigger('terminal:open', 'vm-123');

      mockShell.resize.mockImplementation(() => {
        throw new Error('Resize failed');
      });

      await mockSocket._trigger('terminal:resize', 120, 40);

      expect(handleSSHError).toHaveBeenCalled();
      expect(mockSocket.emit).toHaveBeenCalledWith(
        'terminal:error',
        'Terjadi kesalahan koneksi. Silakan coba lagi.'
      );
    });
  });

  describe('terminal:close', () => {
    it('should close the shell and emit terminal:close', async () => {
      registerTerminalHandlers(mockSocket as any);
      await mockSocket._trigger('terminal:open', 'vm-123');

      await mockSocket._trigger('terminal:close');

      expect(mockShell.close).toHaveBeenCalled();
      expect(mockSocket.emit).toHaveBeenCalledWith('terminal:close');
      expect(getActiveSessions().has('test-socket-id')).toBe(false);
    });

    it('should handle close when no session exists gracefully', async () => {
      registerTerminalHandlers(mockSocket as any);

      // Should not throw
      await mockSocket._trigger('terminal:close');

      expect(mockSocket.emit).toHaveBeenCalledWith('terminal:close');
    });
  });

  describe('disconnect', () => {
    it('should clean up the active session on disconnect', async () => {
      registerTerminalHandlers(mockSocket as any);
      await mockSocket._trigger('terminal:open', 'vm-123');

      expect(getActiveSessions().has('test-socket-id')).toBe(true);

      await mockSocket._trigger('disconnect');

      expect(mockShell.close).toHaveBeenCalled();
      expect(getActiveSessions().has('test-socket-id')).toBe(false);
    });

    it('should handle disconnect when no session exists gracefully', async () => {
      registerTerminalHandlers(mockSocket as any);

      // Should not throw
      await mockSocket._trigger('disconnect');

      expect(getActiveSessions().has('test-socket-id')).toBe(false);
    });
  });

  describe('terminal:check-git', () => {
    it('should emit git-info with branch when directory is a git repo', async () => {
      registerTerminalHandlers(mockSocket as any);
      // Need an active session for check-git to work
      await mockSocket._trigger('terminal:open', 'vm-123');

      // Mock executeCommand to return git info with markers
      mockSSHManager.executeCommand.mockImplementation((_vmId: string, cmd: string) => {
        const startMatch = cmd.match(/__GITCK_(\d+)__/);
        const endMatch = cmd.match(/__GITCK_END_(\d+)__/);
        const marker = `__GITCK_${startMatch?.[1]}__`;
        const endMarker = `__GITCK_END_${endMatch?.[1]}__`;
        return Promise.resolve(`${marker}\n/home/user/project\ntrue\nmain\n${endMarker}`);
      });

      await mockSocket._trigger('terminal:check-git', 'vm-123');

      expect(mockSSHManager.executeCommand).toHaveBeenCalledWith(
        'vm-123',
        expect.stringContaining('git rev-parse --is-inside-work-tree')
      );
      expect(mockSocket.emit).toHaveBeenCalledWith('terminal:git-info', {
        isGit: true,
        branch: 'main',
        directory: '/home/user/project',
      });
    });

    it('should emit git-info with isGit false when not a git repo', async () => {
      registerTerminalHandlers(mockSocket as any);
      await mockSocket._trigger('terminal:open', 'vm-123');

      mockSSHManager.executeCommand.mockImplementation((_vmId: string, cmd: string) => {
        const startMatch = cmd.match(/__GITCK_(\d+)__/);
        const endMatch = cmd.match(/__GITCK_END_(\d+)__/);
        const marker = `__GITCK_${startMatch?.[1]}__`;
        const endMarker = `__GITCK_END_${endMatch?.[1]}__`;
        return Promise.resolve(`${marker}\n/tmp\n${endMarker}`);
      });

      await mockSocket._trigger('terminal:check-git', 'vm-123');

      expect(mockSocket.emit).toHaveBeenCalledWith('terminal:git-info', {
        isGit: false,
        branch: null,
        directory: '/tmp',
      });
    });

    it('should emit isGit false when no active session exists', async () => {
      registerTerminalHandlers(mockSocket as any);

      await mockSocket._trigger('terminal:check-git', 'vm-123');

      expect(mockSocket.emit).toHaveBeenCalledWith('terminal:git-info', {
        isGit: false,
        branch: null,
        directory: '',
      });
    });

    it('should handle detached HEAD state', async () => {
      registerTerminalHandlers(mockSocket as any);
      await mockSocket._trigger('terminal:open', 'vm-123');

      mockSSHManager.executeCommand.mockImplementation((_vmId: string, cmd: string) => {
        const startMatch = cmd.match(/__GITCK_(\d+)__/);
        const endMatch = cmd.match(/__GITCK_END_(\d+)__/);
        const marker = `__GITCK_${startMatch?.[1]}__`;
        const endMarker = `__GITCK_END_${endMatch?.[1]}__`;
        // git branch --show-current returns empty on detached HEAD
        return Promise.resolve(`${marker}\n/home/user/project\ntrue\n${endMarker}`);
      });

      await mockSocket._trigger('terminal:check-git', 'vm-123');

      expect(mockSocket.emit).toHaveBeenCalledWith('terminal:git-info', {
        isGit: true,
        branch: 'HEAD (detached)',
        directory: '/home/user/project',
      });
    });

    it('should emit isGit false when executeCommand throws an error', async () => {
      registerTerminalHandlers(mockSocket as any);
      await mockSocket._trigger('terminal:open', 'vm-123');

      mockSSHManager.executeCommand.mockRejectedValue(new Error('SSH connection failed'));

      await mockSocket._trigger('terminal:check-git', 'vm-123');

      expect(mockSocket.emit).toHaveBeenCalledWith('terminal:git-info', {
        isGit: false,
        branch: null,
        directory: '',
      });
    });
  });
});
