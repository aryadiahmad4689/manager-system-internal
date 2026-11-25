'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import AIAnalyzeModal from '../AIAnalyzeModal';
import {
  formatLogsForCopy,
  parseLogLineForBeautify,
  type LogSeverity,
} from '@/lib/ocp/log-beautifier';
import type { OcpPod } from '@/lib/ocp/types';

interface OcpPodLogsModalProps {
  clusterId: string;
  clusterLabel: string;
  pod: OcpPod;
  onClose: () => void;
}

function getSeverityBadgeClass(level: LogSeverity): string {
  switch (level) {
    case 'error':
      return 'bg-red-900/50 text-red-300 border-red-800';
    case 'warn':
      return 'bg-amber-900/50 text-amber-300 border-amber-800';
    case 'info':
      return 'bg-sky-900/50 text-sky-300 border-sky-800';
    case 'debug':
      return 'bg-gray-800 text-gray-400 border-gray-700';
    default:
      return 'bg-gray-800 text-gray-300 border-gray-700';
  }
}

const JSON_TOKEN_REGEX =
  /("(?:\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"(?:\s*:)?|\b(?:true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g;

function JsonSyntaxHighlight({ json }: { json: string }) {
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let keyIdx = 0;

  JSON_TOKEN_REGEX.lastIndex = 0;
  while ((match = JSON_TOKEN_REGEX.exec(json)) !== null) {
    if (match.index > lastIndex) {
      parts.push(json.slice(lastIndex, match.index));
    }

    const token = match[0];
    let cls = 'text-amber-300';
    if (token.startsWith('"')) {
      cls = token.endsWith(':') ? 'text-cyan-400' : 'text-emerald-400';
    } else if (token === 'true' || token === 'false') {
      cls = 'text-purple-400';
    } else if (token === 'null') {
      cls = 'text-gray-500';
    }

    parts.push(
      <span key={keyIdx++} className={cls}>
        {token}
      </span>
    );
    lastIndex = match.index + token.length;
  }

  if (lastIndex < json.length) {
    parts.push(json.slice(lastIndex));
  }

  return <>{parts}</>;
}

export default function OcpPodLogsModal({
  clusterId,
  clusterLabel,
  pod,
  onClose,
}: OcpPodLogsModalProps) {
  const [container, setContainer] = useState<string>(pod.containers[0] || '');
  const [tailLines, setTailLines] = useState<number>(200);
  const [logs, setLogs] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>('');
  const [isFollowing, setIsFollowing] = useState<boolean>(false);
  const [beautifyJson, setBeautifyJson] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [copied, setCopied] = useState<boolean>(false);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [showAIModal, setShowAIModal] = useState<boolean>(false);

  const logContainerRef = useRef<HTMLDivElement>(null);
  const socketRef = useRef<Socket | null>(null);

  const fetchSnapshot = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({
        namespace: pod.namespace,
        tailLines: String(tailLines),
      });
      if (container) params.set('container', container);

      const res = await fetch(
        `/api/ocp/clusters/${clusterId}/pods/${encodeURIComponent(pod.name)}/logs?${params.toString()}`
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to fetch pod logs');
      }
      setLogs(data.logs || '');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load logs');
    } finally {
      setLoading(false);
    }
  }, [clusterId, pod.namespace, pod.name, container, tailLines]);

  useEffect(() => {
    if (!isFollowing) {
      fetchSnapshot();
    }
  }, [fetchSnapshot, isFollowing]);

  // Live follow mode over Socket.IO
  useEffect(() => {
    if (!isFollowing) {
      if (socketRef.current) {
        socketRef.current.emit('ocp:logs:unsubscribe');
        socketRef.current.disconnect();
        socketRef.current = null;
      }
      return;
    }

    setLogs('');
    setError('');
    setLoading(true);

    const socket = io({
      path: '/api/socketio',
      transports: ['websocket', 'polling'],
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('ocp:logs:subscribe', {
        clusterId,
        namespace: pod.namespace,
        podName: pod.name,
        container: container || undefined,
        tailLines,
      });
    });

    socket.on('ocp:logs:data', (chunk: string) => {
      setLoading(false);
      setLogs((prev) => {
        const combined = prev + chunk;
        return combined.length > 500_000 ? combined.slice(-500_000) : combined;
      });
    });

    socket.on('ocp:logs:error', (msg: string) => {
      setLoading(false);
      setError(msg);
    });

    socket.on('ocp:logs:close', () => {
      setLoading(false);
      setIsFollowing(false);
    });

    socket.on('connect_error', (err) => {
      setLoading(false);
      setError(`Socket connection failed: ${err.message}`);
      setIsFollowing(false);
    });

    return () => {
      socket.emit('ocp:logs:unsubscribe');
      socket.disconnect();
      socketRef.current = null;
    };
  }, [isFollowing, clusterId, pod.namespace, pod.name, container, tailLines]);

  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs]);

  const filteredLines = useMemo(() => {
    if (!logs) return [];
    const lines = logs.split('\n');
    if (!searchQuery.trim()) return lines;
    const q = searchQuery.toLowerCase();
    return lines.filter((line) => line.toLowerCase().includes(q));
  }, [logs, searchQuery]);

  const parsedLines = useMemo(() => {
    if (!beautifyJson) return [];
    return filteredLines
      .filter((line) => line.length > 0)
      .map((line) => parseLogLineForBeautify(line));
  }, [filteredLines, beautifyJson]);

  function handleCopy() {
    if (navigator?.clipboard) {
      navigator.clipboard.writeText(formatLogsForCopy(filteredLines, beautifyJson));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  function handleCopySingle(text: string, idx: number) {
    if (navigator?.clipboard) {
      navigator.clipboard.writeText(text);
      setCopiedIdx(idx);
      setTimeout(() => setCopiedIdx(null), 1500);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 md:p-6">
      <div className="fixed inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <div className="relative w-full max-w-5xl h-[88vh] bg-gray-900 border border-gray-700 rounded-xl shadow-2xl flex flex-col overflow-hidden z-10 text-gray-200">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3.5 border-b border-gray-800 bg-gray-950">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-mono font-bold text-sm md:text-base text-gray-100">{pod.name}</h3>
              <span className="text-xs px-2 py-0.5 rounded bg-gray-800 text-gray-300">
                {clusterLabel} / {pod.namespace}
              </span>
            </div>
            <p className="text-xs text-gray-400">Pod Container Logs</p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {pod.containers.length > 0 && (
              <select
                value={container}
                onChange={(e) => setContainer(e.target.value)}
                className="px-2 py-1 text-xs bg-gray-800 border border-gray-700 rounded text-gray-200"
                aria-label="Select container"
              >
                {pod.containers.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            )}

            <select
              value={tailLines}
              onChange={(e) => setTailLines(Number(e.target.value))}
              className="px-2 py-1 text-xs bg-gray-800 border border-gray-700 rounded text-gray-200"
              aria-label="Tail lines"
            >
              <option value={100}>100 lines</option>
              <option value={200}>200 lines</option>
              <option value={500}>500 lines</option>
              <option value={1000}>1000 lines</option>
            </select>

            <button
              type="button"
              onClick={() => setBeautifyJson((v) => !v)}
              className={`px-2.5 py-1 text-xs font-medium rounded border transition-colors ${
                beautifyJson
                  ? 'bg-cyan-900/60 border-cyan-500 text-cyan-200'
                  : 'bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700'
              }`}
              title="Format dan warnai baris log JSON"
            >
              {beautifyJson ? '{ } Beautify JSON ON' : '{ } Beautify JSON'}
            </button>

            <button
              type="button"
              onClick={() => setIsFollowing((v) => !v)}
              className={`px-2.5 py-1 text-xs font-medium rounded border transition-colors ${
                isFollowing
                  ? 'bg-emerald-900/60 border-emerald-600 text-emerald-300'
                  : 'bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700'
              }`}
            >
              {isFollowing ? '● Live Follow ON' : '○ Live Follow'}
            </button>

            {!isFollowing && (
              <button
                type="button"
                onClick={fetchSnapshot}
                className="px-2.5 py-1 text-xs font-medium rounded bg-gray-800 border border-gray-700 hover:bg-gray-700 text-gray-200"
              >
                Refresh
              </button>
            )}

            <button
              type="button"
              onClick={handleCopy}
              disabled={!logs}
              className="px-2.5 py-1 text-xs font-medium rounded bg-gray-800 border border-gray-700 hover:bg-gray-700 text-gray-200 disabled:opacity-40"
            >
              {copied ? 'Copied!' : 'Copy'}
            </button>

            <button
              type="button"
              onClick={() => setShowAIModal(true)}
              disabled={!logs.trim()}
              className="px-2.5 py-1 text-xs font-medium rounded bg-purple-600 hover:bg-purple-700 text-white disabled:opacity-40"
            >
              ✨ AI Analyze
            </button>

            <button
              type="button"
              onClick={onClose}
              className="p-1 text-gray-400 hover:text-white"
              aria-label="Close logs modal"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Search bar */}
        <div className="px-4 py-2 border-b border-gray-800 bg-gray-900 flex items-center gap-3">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter log lines..."
            className="flex-1 px-3 py-1.5 text-xs bg-gray-800 border border-gray-700 rounded text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <span className="text-xs text-gray-400 font-mono">
            {filteredLines.length} line(s)
          </span>
        </div>

        {/* Log Content */}
        <div
          ref={logContainerRef}
          className="flex-1 overflow-auto p-4 font-mono text-xs leading-relaxed bg-black/90"
        >
          {error && (
            <div className="mb-3 p-3 rounded bg-red-900/40 border border-red-800 text-red-300">
              {error}
            </div>
          )}
          {loading && !logs ? (
            <div className="text-gray-400">Loading pod logs...</div>
          ) : filteredLines.length === 0 ? (
            <div className="text-gray-500">No log lines available.</div>
          ) : beautifyJson ? (
            <div className="space-y-2.5">
              {parsedLines.map((entry, idx) =>
                entry.kind === 'json' ? (
                  <div
                    key={idx}
                    className="rounded-lg border border-gray-800 bg-gray-950/90 overflow-hidden"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5 bg-gray-900/90 border-b border-gray-800">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {entry.prefix && (
                          <span className="text-[11px] text-gray-400 font-mono">
                            {entry.prefix}
                          </span>
                        )}
                        {entry.level !== 'default' && (
                          <span
                            className={`px-1.5 py-0.5 text-[10px] uppercase font-semibold rounded border ${getSeverityBadgeClass(
                              entry.level
                            )}`}
                          >
                            {entry.level}
                          </span>
                        )}
                        {entry.tags.map((tag, tagIdx) => (
                          <span
                            key={`${tag}-${tagIdx}`}
                            className="px-1.5 py-0.5 text-[10px] rounded bg-gray-800 text-gray-300 border border-gray-700"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                      <button
                        type="button"
                        onClick={() => handleCopySingle(entry.formattedJson, idx)}
                        className="px-2 py-0.5 text-[11px] rounded bg-gray-800 hover:bg-gray-700 text-gray-300 border border-gray-700"
                      >
                        {copiedIdx === idx ? 'Copied!' : 'Copy JSON'}
                      </button>
                    </div>
                    <pre className="p-3 overflow-x-auto whitespace-pre-wrap break-words text-gray-200">
                      <JsonSyntaxHighlight json={entry.formattedJson} />
                    </pre>
                  </div>
                ) : (
                  <div
                    key={idx}
                    className={`px-2 py-1 rounded whitespace-pre-wrap break-all ${
                      entry.level === 'error'
                        ? 'text-red-400 bg-red-950/20'
                        : entry.level === 'warn'
                        ? 'text-amber-300'
                        : 'text-gray-300'
                    }`}
                  >
                    {entry.text}
                  </div>
                )
              )}
            </div>
          ) : (
            <pre className="whitespace-pre-wrap break-all text-gray-200">
              {filteredLines.join('\n')}
            </pre>
          )}
        </div>
      </div>

      <AIAnalyzeModal
        isOpen={showAIModal}
        onClose={() => setShowAIModal(false)}
        logText={filteredLines.slice(-150).join('\n')}
      />
    </div>
  );
}
