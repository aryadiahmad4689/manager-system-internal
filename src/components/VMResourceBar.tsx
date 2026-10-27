'use client';

import { useState, useEffect, useCallback } from 'react';
import type { VMResources } from '@/lib/services/resource-monitor';

interface VMResourceBarProps {
  vmId: string;
  isOnline: boolean;
  compact?: boolean;
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

function getProgressColor(percent: number): string {
  if (percent >= 85) return 'bg-red-500';
  if (percent >= 70) return 'bg-yellow-500';
  return 'bg-emerald-500';
}

export default function VMResourceBar({ vmId, isOnline, compact = false }: VMResourceBarProps) {
  const [resources, setResources] = useState<VMResources | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const fetchResources = useCallback(async () => {
    if (!isOnline) return;
    setLoading(true);
    setError(false);
    try {
      const res = await fetch(`/api/vms/${vmId}/resources`);
      if (!res.ok) throw new Error();
      const data: VMResources = await res.json();
      setResources(data);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [vmId, isOnline]);

  useEffect(() => {
    fetchResources();
  }, [fetchResources]);

  if (!isOnline) {
    return (
      <div className="text-xs text-gray-400 dark:text-gray-500 italic py-1">
        VM offline — resources unavailable
      </div>
    );
  }

  if (loading && !resources) {
    return (
      <div className="flex items-center gap-2 py-2 text-xs text-gray-400 animate-pulse">
        <span className="w-2 h-2 rounded-full bg-blue-500 animate-ping" />
        Memuat data CPU/RAM/Disk...
      </div>
    );
  }

  if (error && !resources) {
    return (
      <div className="flex items-center justify-between py-1 text-xs text-gray-400">
        <span>Gagal memuat resource</span>
        <button
          onClick={fetchResources}
          className="text-blue-500 hover:underline"
        >
          Coba lagi
        </button>
      </div>
    );
  }

  if (!resources) return null;

  if (compact) {
    return (
      <div className="flex items-center gap-3 text-xs text-gray-600 dark:text-gray-300 font-mono">
        <span title={`CPU Usage: ${resources.cpuPercent}%`}>
          CPU: <strong>{resources.cpuPercent}%</strong>
        </span>
        <span title={`RAM: ${formatBytes(resources.ram.usedBytes)} / ${formatBytes(resources.ram.totalBytes)}`}>
          RAM: <strong>{resources.ram.percent}%</strong>
        </span>
        <span title={`Disk: ${formatBytes(resources.disk.usedBytes)} / ${formatBytes(resources.disk.totalBytes)}`}>
          Disk: <strong>{resources.disk.percent}%</strong>
        </span>
      </div>
    );
  }

  return (
    <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-700/60 text-xs space-y-2">
      {/* Top Header info (Uptime & Refresh) */}
      <div className="flex items-center justify-between text-gray-500 dark:text-gray-400">
        <span className="truncate max-w-[200px]" title={resources.uptime}>
          🕒 {resources.uptime}
        </span>
        <button
          onClick={fetchResources}
          disabled={loading}
          className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 hover:text-gray-600 transition-colors"
          title="Pindai ulang resource"
        >
          <svg className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-blue-500' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </button>
      </div>

      {/* CPU */}
      <div>
        <div className="flex justify-between text-xs mb-1">
          <span className="text-gray-500 dark:text-gray-400">CPU</span>
          <span className="font-mono font-medium text-gray-700 dark:text-gray-300">
            {resources.cpuPercent}%
          </span>
        </div>
        <div className="w-full bg-gray-100 dark:bg-gray-700 h-1.5 rounded-full overflow-hidden">
          <div
            className={`h-full transition-all duration-300 ${getProgressColor(resources.cpuPercent)}`}
            style={{ width: `${Math.min(100, resources.cpuPercent)}%` }}
          />
        </div>
      </div>

      {/* RAM */}
      <div>
        <div className="flex justify-between text-xs mb-1">
          <span className="text-gray-500 dark:text-gray-400">RAM</span>
          <span className="font-mono font-medium text-gray-700 dark:text-gray-300">
            {formatBytes(resources.ram.usedBytes)} / {formatBytes(resources.ram.totalBytes)} ({resources.ram.percent}%)
          </span>
        </div>
        <div className="w-full bg-gray-100 dark:bg-gray-700 h-1.5 rounded-full overflow-hidden">
          <div
            className={`h-full transition-all duration-300 ${getProgressColor(resources.ram.percent)}`}
            style={{ width: `${Math.min(100, resources.ram.percent)}%` }}
          />
        </div>
      </div>

      {/* Disk */}
      <div>
        <div className="flex justify-between text-xs mb-1">
          <span className="text-gray-500 dark:text-gray-400">Disk ({resources.disk.mount})</span>
          <span className="font-mono font-medium text-gray-700 dark:text-gray-300">
            {formatBytes(resources.disk.freeBytes)} free ({resources.disk.percent}%)
          </span>
        </div>
        <div className="w-full bg-gray-100 dark:bg-gray-700 h-1.5 rounded-full overflow-hidden">
          <div
            className={`h-full transition-all duration-300 ${getProgressColor(resources.disk.percent)}`}
            style={{ width: `${Math.min(100, resources.disk.percent)}%` }}
          />
        </div>
      </div>
    </div>
  );
}
