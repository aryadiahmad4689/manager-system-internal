'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import { io, Socket } from 'socket.io-client';

/**
 * VM status as returned by the API and Socket.IO events.
 */
export interface VMStatus {
  vmId: string;
  status: 'online' | 'offline' | 'unreachable';
  lastChecked: Date | string;
  failCount: number;
}

/**
 * Options for the useVMStatusPolling hook.
 */
export interface UseVMStatusPollingOptions {
  /** List of VM IDs to poll status for */
  vmIds: string[];
  /** Polling interval in milliseconds (default: 60000 = 60 seconds) */
  pollingInterval?: number;
  /** Whether polling and socket connection are enabled (default: true) */
  enabled?: boolean;
}

/**
 * Return type for the useVMStatusPolling hook.
 */
export interface UseVMStatusPollingResult {
  /** Map of vmId → current status */
  statusMap: Map<string, VMStatus>;
  /** Whether the socket is connected */
  isConnected: boolean;
}

const DEFAULT_POLLING_INTERVAL = 60000; // 60 seconds

/**
 * Custom hook that polls VM statuses every 60 seconds via API
 * and listens for real-time `vm:statusChange` Socket.IO events.
 *
 * Returns a map of vmId → VMStatus that updates in real-time.
 */
export function useVMStatusPolling({
  vmIds,
  pollingInterval = DEFAULT_POLLING_INTERVAL,
  enabled = true,
}: UseVMStatusPollingOptions): UseVMStatusPollingResult {
  const [statusMap, setStatusMap] = useState<Map<string, VMStatus>>(new Map());
  const [isConnected, setIsConnected] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /**
   * Fetches the status of a single VM via the API.
   */
  const fetchVMStatus = useCallback(async (vmId: string): Promise<VMStatus | null> => {
    try {
      const res = await fetch(`/api/vms/${vmId}/status`);
      if (res.ok) {
        const data = await res.json();
        return data as VMStatus;
      }
    } catch {
      // Silently ignore fetch errors — status will be updated on next poll
    }
    return null;
  }, []);

  /**
   * Polls all VM statuses and updates the status map.
   */
  const pollAllStatuses = useCallback(async () => {
    if (vmIds.length === 0) return;

    const results = await Promise.all(vmIds.map(fetchVMStatus));

    setStatusMap((prev) => {
      const next = new Map(prev);
      results.forEach((result) => {
        if (result) {
          next.set(result.vmId, result);
        }
      });
      return next;
    });
  }, [vmIds, fetchVMStatus]);

  // Set up polling interval
  useEffect(() => {
    if (!enabled || vmIds.length === 0) return;

    // Poll immediately on mount/change
    pollAllStatuses();

    // Set up interval for subsequent polls
    intervalRef.current = setInterval(pollAllStatuses, pollingInterval);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [enabled, vmIds, pollingInterval, pollAllStatuses]);

  // Set up Socket.IO connection for real-time updates
  useEffect(() => {
    if (!enabled) return;

    const socket = io({
      path: '/api/socketio',
      addTrailingSlash: false,
      transports: ['websocket', 'polling'],
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      setIsConnected(true);
    });

    socket.on('disconnect', () => {
      setIsConnected(false);
    });

    // Listen for real-time VM status change events
    socket.on('vm:statusChange', (status: VMStatus) => {
      setStatusMap((prev) => {
        const next = new Map(prev);
        next.set(status.vmId, status);
        return next;
      });
    });

    return () => {
      socket.off('vm:statusChange');
      socket.disconnect();
      socketRef.current = null;
      setIsConnected(false);
    };
  }, [enabled]);

  return { statusMap, isConnected };
}
