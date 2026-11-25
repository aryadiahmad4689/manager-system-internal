'use client';

import { useEffect, useState } from 'react';
import type { OcpDescribeKind, OcpDescribeResponse } from '@/lib/ocp/types';

interface OcpDescribeModalProps {
  clusterId: string;
  namespace: string;
  kind: OcpDescribeKind;
  name: string;
  onClose: () => void;
}

export default function OcpDescribeModal({
  clusterId,
  namespace,
  kind,
  name,
  onClose,
}: OcpDescribeModalProps) {
  const [data, setData] = useState<OcpDescribeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<'events' | 'spec'>('events');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError('');
      try {
        const params = new URLSearchParams({ namespace, kind, name });
        const res = await fetch(`/api/ocp/clusters/${clusterId}/describe?${params.toString()}`);
        const json = await res.json();
        if (!res.ok) {
          throw new Error(json.error || 'Failed to describe resource');
        }
        if (!cancelled) {
          setData(json);
          if (!json.events || json.events.length === 0) {
            setActiveTab('spec');
          }
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load details');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [clusterId, namespace, kind, name]);

  const jsonPretty = data ? JSON.stringify(data.resource, null, 2) : '';

  function handleCopy() {
    if (navigator?.clipboard && jsonPretty) {
      navigator.clipboard.writeText(jsonPretty);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 md:p-6">
      <div className="fixed inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <div className="relative w-full max-w-4xl h-[85vh] bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-2xl flex flex-col overflow-hidden z-10">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-200 dark:border-gray-800">
          <div>
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 text-xs font-semibold rounded bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300">
                {kind}
              </span>
              <h3 className="font-mono font-bold text-base text-gray-900 dark:text-gray-100">
                {name}
              </h3>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400">Namespace: {namespace}</p>
          </div>

          <div className="flex items-center gap-2">
            {jsonPretty && (
              <button
                type="button"
                onClick={handleCopy}
                className="px-3 py-1 text-xs font-medium rounded border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
              >
                {copied ? 'Copied JSON' : 'Copy JSON'}
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-1 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
              aria-label="Close describe modal"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2 px-5 pt-2 border-b border-gray-200 dark:border-gray-800">
          <button
            type="button"
            onClick={() => setActiveTab('events')}
            className={`px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
              activeTab === 'events'
                ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
            }`}
          >
            Events ({data?.events.length ?? 0})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('spec')}
            className={`px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
              activeTab === 'spec'
                ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
            }`}
          >
            Resource Spec / Status (JSON)
          </button>
        </div>

        <div className="flex-1 overflow-auto p-5">
          {loading ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">Loading resource details...</p>
          ) : error ? (
            <div className="p-3 text-sm text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg">
              {error}
            </div>
          ) : activeTab === 'events' ? (
            data && data.events.length > 0 ? (
              <div className="space-y-2">
                {data.events.map((ev, idx) => (
                  <div
                    key={`${ev.reason}-${idx}`}
                    className="p-3 rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50"
                  >
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <div className="flex items-center gap-2">
                        <span
                          className={`px-2 py-0.5 text-[11px] font-semibold rounded ${
                            ev.type === 'Warning'
                              ? 'bg-amber-100 dark:bg-amber-900/50 text-amber-800 dark:text-amber-300'
                              : 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-800 dark:text-emerald-300'
                          }`}
                        >
                          {ev.type}
                        </span>
                        <span className="font-mono text-xs font-semibold text-gray-900 dark:text-gray-100">
                          {ev.reason}
                        </span>
                        {ev.count > 1 && (
                          <span className="text-xs text-gray-500">x{ev.count}</span>
                        )}
                      </div>
                      <span className="text-xs text-gray-500 font-mono">
                        {ev.lastTimestamp || '-'}
                      </span>
                    </div>
                    <p className="text-xs text-gray-700 dark:text-gray-300">{ev.message}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-500 dark:text-gray-400">No recent events found for this resource.</p>
            )
          ) : (
            <pre className="text-xs font-mono text-gray-800 dark:text-gray-200 bg-gray-50 dark:bg-gray-950 p-4 rounded-lg border border-gray-200 dark:border-gray-800 overflow-auto whitespace-pre-wrap break-all">
              {jsonPretty}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}
