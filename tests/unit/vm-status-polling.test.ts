/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useVMStatusPolling } from '@/hooks/useVMStatusPolling';

// Mock socket.io-client
const mockOn = vi.fn();
const mockOff = vi.fn();
const mockDisconnect = vi.fn();
const mockIo = vi.fn(() => ({
  on: mockOn,
  off: mockOff,
  disconnect: mockDisconnect,
  connected: false,
}));

vi.mock('socket.io-client', () => ({
  io: (...args: unknown[]) => mockIo(...args),
}));

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('useVMStatusPolling', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockOn.mockReset();
    mockOff.mockReset();
    mockDisconnect.mockReset();
    mockIo.mockClear();
    mockIo.mockReturnValue({
      on: mockOn,
      off: mockOff,
      disconnect: mockDisconnect,
      connected: false,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return an empty status map initially', () => {
    const { result } = renderHook(() =>
      useVMStatusPolling({ vmIds: [], enabled: false })
    );

    expect(result.current.statusMap.size).toBe(0);
    expect(result.current.isConnected).toBe(false);
  });

  it('should poll VM statuses on mount when enabled', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        vmId: 'vm-1',
        status: 'online',
        lastChecked: new Date().toISOString(),
        failCount: 0,
      }),
    });

    const { result } = renderHook(() =>
      useVMStatusPolling({ vmIds: ['vm-1'], enabled: true, pollingInterval: 600000 })
    );

    await waitFor(() => {
      expect(result.current.statusMap.size).toBe(1);
    });

    expect(mockFetch).toHaveBeenCalledWith('/api/vms/vm-1/status');
    const status = result.current.statusMap.get('vm-1');
    expect(status?.status).toBe('online');
  });

  it('should poll multiple VMs', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('vm-1')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            vmId: 'vm-1',
            status: 'online',
            lastChecked: new Date().toISOString(),
            failCount: 0,
          }),
        });
      }
      if (url.includes('vm-2')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            vmId: 'vm-2',
            status: 'offline',
            lastChecked: new Date().toISOString(),
            failCount: 1,
          }),
        });
      }
      return Promise.resolve({ ok: false });
    });

    const { result } = renderHook(() =>
      useVMStatusPolling({ vmIds: ['vm-1', 'vm-2'], enabled: true, pollingInterval: 600000 })
    );

    await waitFor(() => {
      expect(result.current.statusMap.size).toBe(2);
    });

    expect(result.current.statusMap.get('vm-1')?.status).toBe('online');
    expect(result.current.statusMap.get('vm-2')?.status).toBe('offline');
  });

  it('should poll at the specified interval', async () => {
    let callCount = 0;
    mockFetch.mockImplementation(() => {
      callCount++;
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          vmId: 'vm-1',
          status: 'online',
          lastChecked: new Date().toISOString(),
          failCount: 0,
        }),
      });
    });

    // Use a very short interval for testing
    renderHook(() =>
      useVMStatusPolling({
        vmIds: ['vm-1'],
        enabled: true,
        pollingInterval: 100, // 100ms for fast test
      })
    );

    // Wait for initial poll
    await waitFor(() => {
      expect(callCount).toBeGreaterThanOrEqual(1);
    });

    const initialCount = callCount;

    // Wait for at least one more poll cycle
    await waitFor(() => {
      expect(callCount).toBeGreaterThan(initialCount);
    }, { timeout: 500 });
  });

  it('should not poll when disabled', () => {
    renderHook(() =>
      useVMStatusPolling({ vmIds: ['vm-1'], enabled: false })
    );

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('should not poll when vmIds is empty', () => {
    renderHook(() =>
      useVMStatusPolling({ vmIds: [], enabled: true })
    );

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('should handle fetch errors gracefully', async () => {
    // Use a fetch that rejects
    mockFetch.mockImplementation(() => Promise.reject(new Error('Network error')));

    const { result } = renderHook(() =>
      useVMStatusPolling({ vmIds: ['vm-1'], enabled: true, pollingInterval: 600000 })
    );

    // Wait for the fetch to be attempted
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith('/api/vms/vm-1/status');
    });

    // Status map should remain empty since fetch failed
    expect(result.current.statusMap.size).toBe(0);
  });

  it('should handle non-ok responses gracefully', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500 });

    const { result } = renderHook(() =>
      useVMStatusPolling({ vmIds: ['vm-1'], enabled: true, pollingInterval: 600000 })
    );

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith('/api/vms/vm-1/status');
    });

    // Status map should remain empty since response was not ok
    expect(result.current.statusMap.size).toBe(0);
  });

  it('should connect to Socket.IO and listen for vm:statusChange events', () => {
    renderHook(() =>
      useVMStatusPolling({ vmIds: ['vm-1'], enabled: true, pollingInterval: 600000 })
    );

    expect(mockOn).toHaveBeenCalledWith('connect', expect.any(Function));
    expect(mockOn).toHaveBeenCalledWith('disconnect', expect.any(Function));
    expect(mockOn).toHaveBeenCalledWith('vm:statusChange', expect.any(Function));
  });

  it('should connect Socket.IO with correct path', () => {
    renderHook(() =>
      useVMStatusPolling({ vmIds: ['vm-1'], enabled: true, pollingInterval: 600000 })
    );

    expect(mockIo).toHaveBeenCalledWith(
      expect.objectContaining({
        path: '/api/socketio',
        addTrailingSlash: false,
      })
    );
  });

  it('should update statusMap when vm:statusChange event is received', () => {
    mockFetch.mockResolvedValue({ ok: false });

    const { result } = renderHook(() =>
      useVMStatusPolling({ vmIds: ['vm-1'], enabled: true, pollingInterval: 600000 })
    );

    // Find the vm:statusChange handler
    const statusChangeHandler = mockOn.mock.calls.find(
      (call) => call[0] === 'vm:statusChange'
    )?.[1];

    expect(statusChangeHandler).toBeDefined();

    act(() => {
      statusChangeHandler({
        vmId: 'vm-1',
        status: 'unreachable',
        lastChecked: new Date().toISOString(),
        failCount: 3,
      });
    });

    expect(result.current.statusMap.get('vm-1')?.status).toBe('unreachable');
    expect(result.current.statusMap.get('vm-1')?.failCount).toBe(3);
  });

  it('should update statusMap for status changes to online (green indicator)', () => {
    mockFetch.mockResolvedValue({ ok: false });

    const { result } = renderHook(() =>
      useVMStatusPolling({ vmIds: ['vm-1'], enabled: true, pollingInterval: 600000 })
    );

    const statusChangeHandler = mockOn.mock.calls.find(
      (call) => call[0] === 'vm:statusChange'
    )?.[1];

    act(() => {
      statusChangeHandler({
        vmId: 'vm-1',
        status: 'online',
        lastChecked: new Date().toISOString(),
        failCount: 0,
      });
    });

    expect(result.current.statusMap.get('vm-1')?.status).toBe('online');
  });

  it('should update statusMap for status changes to offline (red indicator)', () => {
    mockFetch.mockResolvedValue({ ok: false });

    const { result } = renderHook(() =>
      useVMStatusPolling({ vmIds: ['vm-1'], enabled: true, pollingInterval: 600000 })
    );

    const statusChangeHandler = mockOn.mock.calls.find(
      (call) => call[0] === 'vm:statusChange'
    )?.[1];

    act(() => {
      statusChangeHandler({
        vmId: 'vm-1',
        status: 'offline',
        lastChecked: new Date().toISOString(),
        failCount: 1,
      });
    });

    expect(result.current.statusMap.get('vm-1')?.status).toBe('offline');
  });

  it('should set isConnected to true when socket connects', () => {
    const { result } = renderHook(() =>
      useVMStatusPolling({ vmIds: ['vm-1'], enabled: true, pollingInterval: 600000 })
    );

    const connectHandler = mockOn.mock.calls.find(
      (call) => call[0] === 'connect'
    )?.[1];

    act(() => {
      connectHandler();
    });

    expect(result.current.isConnected).toBe(true);
  });

  it('should set isConnected to false when socket disconnects', () => {
    const { result } = renderHook(() =>
      useVMStatusPolling({ vmIds: ['vm-1'], enabled: true, pollingInterval: 600000 })
    );

    const connectHandler = mockOn.mock.calls.find(
      (call) => call[0] === 'connect'
    )?.[1];
    const disconnectHandler = mockOn.mock.calls.find(
      (call) => call[0] === 'disconnect'
    )?.[1];

    act(() => {
      connectHandler();
    });
    expect(result.current.isConnected).toBe(true);

    act(() => {
      disconnectHandler();
    });
    expect(result.current.isConnected).toBe(false);
  });

  it('should clean up socket on unmount', () => {
    const { unmount } = renderHook(() =>
      useVMStatusPolling({ vmIds: ['vm-1'], enabled: true, pollingInterval: 600000 })
    );

    unmount();

    expect(mockOff).toHaveBeenCalledWith('vm:statusChange');
    expect(mockDisconnect).toHaveBeenCalled();
  });

  it('should not connect socket when disabled', () => {
    mockIo.mockClear();

    renderHook(() =>
      useVMStatusPolling({ vmIds: ['vm-1'], enabled: false })
    );

    expect(mockIo).not.toHaveBeenCalled();
  });
});
