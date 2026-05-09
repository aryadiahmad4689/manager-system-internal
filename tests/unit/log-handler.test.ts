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

// Mock the log reader module (only parseLogLine is used)
vi.mock('@/lib/logs/log-reader', () => ({
  parseLogLine: vi.fn(),
}));

import { getSSHManager } from '@/lib/ssh/ssh-manager';
import { handleSSHError } from '@/lib/ssh/ssh-error-handler';
import { parseLogLine } from '@/lib/logs/log-reader';
import {
  registerLogHandlers,
  getActiveSubscriptions,
  clearActiveSubscriptions,
} from '@/lib/socket/log-handler';

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

describe('Log Handler', () => {
  let mockSocket: ReturnType<typeof createMockSocket>;
  let mockShell: ReturnType<typeof createMockShell>;
  let mockSSHManager: { openShell: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    mockSocket = createMockSocket();
    mockShell = createMockShell();
    mockSSHManager = {
      openShell: vi.fn().mockResolvedValue(mockShell),
    };

    vi.mocked(getSSHManager).mockReturnValue(mockSSHManager as any);
    vi.mocked(handleSSHError).mockReturnValue({
      type: 'unknown',
      message: 'Terjadi kesalahan koneksi. Silakan coba lagi.',
      action: 'none',
      retryable: false,
    });

    // Default parseLogLine mock: parse lines that match the CI format
    vi.mocked(parseLogLine).mockImplementation((line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return null;
      const match = trimmed.match(/^(ERROR|DEBUG|INFO|ALL)\s+-\s+(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})\s+-->\s+(.+)$/);
      if (match) {
        return {
          level: match[1] as 'ERROR' | 'DEBUG' | 'INFO' | 'ALL',
          timestamp: match[2],
          message: match[3],
          raw: trimmed,
        };
      }
      return { level: 'ALL', timestamp: '', message: trimmed, raw: trimmed };
    });
  });

  afterEach(() => {
    clearActiveSubscriptions();
    vi.clearAllMocks();
  });

  describe('registerLogHandlers', () => {
    it('should register log:subscribe, log:unsubscribe, and disconnect handlers', () => {
      registerLogHandlers(mockSocket as any);

      expect(mockSocket.on).toHaveBeenCalledWith('log:subscribe', expect.any(Function));
      expect(mockSocket.on).toHaveBeenCalledWith('log:unsubscribe', expect.any(Function));
      expect(mockSocket.on).toHaveBeenCalledWith('disconnect', expect.any(Function));
    });
  });

  describe('log:subscribe', () => {
    it('should open an SSH shell and write tail -f command', async () => {
      registerLogHandlers(mockSocket as any);

      await mockSocket._trigger('log:subscribe', 'vm-123', 'myproject', 'log-2024-01-15.php');

      expect(mockSSHManager.openShell).toHaveBeenCalledWith('vm-123');
      expect(mockShell.write).toHaveBeenCalledWith(
        'tail -f /var/www/html/myproject/application/logs/log-2024-01-15.php\n'
      );
      expect(mockShell.onData).toHaveBeenCalledWith(expect.any(Function));
      expect(mockShell.onClose).toHaveBeenCalledWith(expect.any(Function));
    });

    it('should track the subscription', async () => {
      registerLogHandlers(mockSocket as any);

      await mockSocket._trigger('log:subscribe', 'vm-123', 'myproject', 'log-2024-01-15.php');

      const subscriptions = getActiveSubscriptions();
      expect(subscriptions.has('test-socket-id')).toBe(true);
      expect(subscriptions.get('test-socket-id')!.vmId).toBe('vm-123');
      expect(subscriptions.get('test-socket-id')!.project).toBe('myproject');
      expect(subscriptions.get('test-socket-id')!.filename).toBe('log-2024-01-15.php');
    });

    it('should parse and emit log entries when data arrives', async () => {
      registerLogHandlers(mockSocket as any);

      await mockSocket._trigger('log:subscribe', 'vm-123', 'myproject', 'log-2024-01-15.php');

      // Simulate tail output with a complete line
      mockShell._dataCallback!('ERROR - 2024-01-15 10:23:45 --> Something went wrong\n');

      expect(parseLogLine).toHaveBeenCalledWith('ERROR - 2024-01-15 10:23:45 --> Something went wrong');
      expect(mockSocket.emit).toHaveBeenCalledWith('log:newEntry', {
        level: 'ERROR',
        timestamp: '2024-01-15 10:23:45',
        message: 'Something went wrong',
        raw: 'ERROR - 2024-01-15 10:23:45 --> Something went wrong',
      });
    });

    it('should buffer incomplete lines until newline arrives', async () => {
      registerLogHandlers(mockSocket as any);

      await mockSocket._trigger('log:subscribe', 'vm-123', 'myproject', 'log-2024-01-15.php');

      // Send partial data (no newline)
      mockShell._dataCallback!('ERROR - 2024-01-15 10:23:45 --> Partial');

      // No emit yet since line is incomplete
      expect(mockSocket.emit).not.toHaveBeenCalledWith('log:newEntry', expect.anything());

      // Complete the line
      mockShell._dataCallback!(' message\n');

      expect(parseLogLine).toHaveBeenCalledWith('ERROR - 2024-01-15 10:23:45 --> Partial message');
    });

    it('should handle multiple lines in a single data chunk', async () => {
      registerLogHandlers(mockSocket as any);

      await mockSocket._trigger('log:subscribe', 'vm-123', 'myproject', 'log-2024-01-15.php');

      mockShell._dataCallback!(
        'ERROR - 2024-01-15 10:23:45 --> Error one\nDEBUG - 2024-01-15 10:23:46 --> Debug two\n'
      );

      expect(parseLogLine).toHaveBeenCalledWith('ERROR - 2024-01-15 10:23:45 --> Error one');
      expect(parseLogLine).toHaveBeenCalledWith('DEBUG - 2024-01-15 10:23:46 --> Debug two');
      expect(mockSocket.emit).toHaveBeenCalledTimes(2);
    });

    it('should not emit for lines that parseLogLine returns null for', async () => {
      vi.mocked(parseLogLine).mockReturnValue(null);

      registerLogHandlers(mockSocket as any);

      await mockSocket._trigger('log:subscribe', 'vm-123', 'myproject', 'log-2024-01-15.php');

      mockShell._dataCallback!('<?php defined(\'BASEPATH\') OR exit(\'No direct script access allowed\'); ?>\n');

      expect(mockSocket.emit).not.toHaveBeenCalledWith('log:newEntry', expect.anything());
    });

    it('should close existing subscription before opening a new one', async () => {
      registerLogHandlers(mockSocket as any);

      // Open first subscription
      await mockSocket._trigger('log:subscribe', 'vm-111', 'project1', 'log-2024-01-01.php');
      const firstShell = mockShell;

      // Create a new mock shell for the second subscription
      const secondShell = createMockShell();
      mockSSHManager.openShell.mockResolvedValue(secondShell);

      // Open second subscription
      await mockSocket._trigger('log:subscribe', 'vm-222', 'project2', 'log-2024-01-02.php');

      expect(firstShell.close).toHaveBeenCalled();
      const subscriptions = getActiveSubscriptions();
      expect(subscriptions.get('test-socket-id')!.vmId).toBe('vm-222');
      expect(subscriptions.get('test-socket-id')!.project).toBe('project2');
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

      registerLogHandlers(mockSocket as any);

      await mockSocket._trigger('log:subscribe', 'vm-123', 'myproject', 'log-2024-01-15.php');

      expect(handleSSHError).toHaveBeenCalledWith(sshError);
      expect(mockSocket.emit).toHaveBeenCalledWith(
        'terminal:error',
        'Koneksi ke VM timeout. Periksa apakah VM aktif.'
      );
    });

    it('should clean up subscription when shell closes', async () => {
      registerLogHandlers(mockSocket as any);

      await mockSocket._trigger('log:subscribe', 'vm-123', 'myproject', 'log-2024-01-15.php');

      expect(getActiveSubscriptions().has('test-socket-id')).toBe(true);

      // Simulate shell close
      mockShell._closeCallback!();

      expect(getActiveSubscriptions().has('test-socket-id')).toBe(false);
    });
  });

  describe('log:unsubscribe', () => {
    it('should close the shell and remove the subscription', async () => {
      registerLogHandlers(mockSocket as any);

      await mockSocket._trigger('log:subscribe', 'vm-123', 'myproject', 'log-2024-01-15.php');
      expect(getActiveSubscriptions().has('test-socket-id')).toBe(true);

      await mockSocket._trigger('log:unsubscribe');

      expect(mockShell.close).toHaveBeenCalled();
      expect(getActiveSubscriptions().has('test-socket-id')).toBe(false);
    });

    it('should handle unsubscribe when no subscription exists gracefully', async () => {
      registerLogHandlers(mockSocket as any);

      // Should not throw
      await mockSocket._trigger('log:unsubscribe');

      expect(getActiveSubscriptions().has('test-socket-id')).toBe(false);
    });
  });

  describe('disconnect', () => {
    it('should clean up the active subscription on disconnect', async () => {
      registerLogHandlers(mockSocket as any);

      await mockSocket._trigger('log:subscribe', 'vm-123', 'myproject', 'log-2024-01-15.php');
      expect(getActiveSubscriptions().has('test-socket-id')).toBe(true);

      await mockSocket._trigger('disconnect');

      expect(mockShell.close).toHaveBeenCalled();
      expect(getActiveSubscriptions().has('test-socket-id')).toBe(false);
    });

    it('should handle disconnect when no subscription exists gracefully', async () => {
      registerLogHandlers(mockSocket as any);

      // Should not throw
      await mockSocket._trigger('disconnect');

      expect(getActiveSubscriptions().has('test-socket-id')).toBe(false);
    });
  });
});
