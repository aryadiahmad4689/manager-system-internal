'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import AIAnalyzeModal from './AIAnalyzeModal';

interface ServiceLogsModalProps {
  vmId: string;
  vmLabel: string;
  unitName: string;
  onClose: () => void;
}

export default function ServiceLogsModal({
  vmId,
  vmLabel,
  unitName,
  onClose,
}: ServiceLogsModalProps) {
  const [logs, setLogs] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lines, setLines] = useState<number>(100);
  const [autoRefresh, setAutoRefresh] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [copied, setCopied] = useState<boolean>(false);
  const [showAIModal, setShowAIModal] = useState<boolean>(false);
  const [selectedLogText, setSelectedLogText] = useState<string>('');
  const logContainerRef = useRef<HTMLDivElement>(null);

  const fetchLogs = useCallback(async (isSilent = false) => {
    if (!isSilent) setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/vms/${vmId}/services/logs?unit=${encodeURIComponent(unitName)}&lines=${lines}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}: Failed to fetch logs`);
      }
      const data = await res.json();
      setLogs(data.logs || '');
    } catch (err: any) {
      setError(err.message || 'Gagal mengambil log.');
    } finally {
      if (!isSilent) setLoading(false);
    }
  }, [vmId, unitName, lines]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  // Auto-refresh interval
  useEffect(() => {
    if (!autoRefresh) return;
    const timer = setInterval(() => {
      fetchLogs(true);
    }, 3000);
    return () => clearInterval(timer);
  }, [autoRefresh, fetchLogs]);

  // Scroll to bottom on initial load
  useEffect(() => {
    if (!loading && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [loading]);

  const handleCopy = useCallback(() => {
    if (navigator?.clipboard) {
      navigator.clipboard.writeText(logs);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [logs]);

  const filteredLogLines = useMemo(() => {
    if (!logs) return [];
    const allLines = logs.split('\n');
    if (!searchQuery.trim()) return allLines;
    const q = searchQuery.toLowerCase();
    return allLines.filter((l) => l.toLowerCase().includes(q));
  }, [logs, searchQuery]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 md:p-6" data-testid="service-logs-modal">
      <div className="fixed inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />

      <div className="relative w-full max-w-5xl h-[88vh] bg-gray-900 border border-gray-700 rounded-xl shadow-2xl flex flex-col overflow-hidden z-10 text-gray-200">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-800 bg-gray-950">
          <div className="flex items-center gap-2.5">
            <span className="p-1.5 rounded-lg bg-blue-900/60 text-blue-400">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </span>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-mono font-bold text-base text-gray-100">{unitName}</h3>
                <span className="text-xs px-2 py-0.5 rounded bg-gray-800 text-gray-400 font-medium">
                  {vmLabel}
                </span>
              </div>
              <p className="text-xs text-gray-500">journalctl -u {unitName} -n {lines}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Auto refresh toggle */}
            <label className="flex items-center gap-1.5 text-xs text-gray-400 cursor-pointer hover:text-gray-300">
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
                className="rounded border-gray-700 text-blue-600 focus:ring-0 focus:ring-offset-0 bg-gray-800"
              />
              <span>Live (3s)</span>
            </label>

            {/* Line count select */}
            <select
              value={lines}
              onChange={(e) => setLines(Number(e.target.value))}
              className="bg-gray-800 border border-gray-700 rounded text-xs px-2 py-1 text-gray-300 focus:outline-none"
            >
              <option value={50}>50 baris</option>
              <option value={100}>100 baris</option>
              <option value={200}>200 baris</option>
              <option value={500}>500 baris</option>
            </select>

            {/* Refresh button */}
            <button
              onClick={() => fetchLogs(false)}
              disabled={loading}
              className="p-1.5 rounded bg-gray-800 hover:bg-gray-700 text-gray-300 transition-colors"
              title="Refresh log"
            >
              <svg className={`w-4 h-4 ${loading ? 'animate-spin text-blue-400' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>

            {/* Copy button */}
            <button
              onClick={handleCopy}
              className="px-2.5 py-1 text-xs font-medium rounded bg-gray-800 hover:bg-gray-700 text-gray-300 transition-colors"
              title="Salin seluruh log"
            >
              {copied ? '✓ Tersalin' : 'Salin'}
            </button>

            {/* AI Analyze button */}
            <button
              onClick={() => {
                setSelectedLogText(logs.slice(-2000));
                setShowAIModal(true);
              }}
              className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded bg-purple-900/60 hover:bg-purple-800 text-purple-200 border border-purple-700 transition-colors"
              title="Analisis error dengan AI"
            >
              <span>✨</span>
              <span>AI Analyze</span>
            </button>

            {/* Close button */}
            <button
              onClick={onClose}
              className="p-1.5 rounded text-gray-400 hover:text-gray-200 hover:bg-gray-800 transition-colors"
              aria-label="Tutup"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Search bar inside logs */}
        <div className="px-4 py-2 border-b border-gray-800 bg-gray-950/60 flex items-center gap-2">
          <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            placeholder="Cari kata kunci dalam log (contoh: error, panic, failed, status)..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-transparent text-xs text-gray-200 placeholder-gray-500 focus:outline-none"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} className="text-xs text-gray-400 hover:text-gray-200">
              Clear
            </button>
          )}
        </div>

        {/* Logs Viewer */}
        <div
          ref={logContainerRef}
          className="flex-1 overflow-y-auto p-4 font-mono text-xs leading-relaxed select-text bg-black/80"
        >
          {loading && !logs && (
            <div className="flex flex-col items-center justify-center py-20 text-gray-500">
              <svg className="w-6 h-6 animate-spin text-blue-500 mb-2" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              <span>Mengambil log dari {unitName}...</span>
            </div>
          )}

          {!loading && error && (
            <div className="p-4 text-red-400 bg-red-950/40 border border-red-900 rounded">
              Gagal memuat log: {error}
            </div>
          )}

          {!loading && !error && filteredLogLines.length === 0 && (
            <div className="text-gray-500 text-center py-10 italic">
              Tidak ada log yang ditemukan.
            </div>
          )}

          {filteredLogLines.map((line, idx) => {
            const isError = /error|fatal|panic|failed|exception/i.test(line);
            const isWarn = /warn|warning/i.test(line);

            return (
              <div
                key={idx}
                className={`py-0.5 px-1 rounded hover:bg-gray-800/60 transition-colors whitespace-pre-wrap break-all ${
                  isError ? 'text-red-400 bg-red-950/20' : isWarn ? 'text-yellow-400' : 'text-gray-300'
                }`}
              >
                {line}
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="px-5 py-2.5 border-t border-gray-800 bg-gray-950 text-xs text-gray-500 flex items-center justify-between">
          <span>Menampilkan {filteredLogLines.length} baris log</span>
          <button
            onClick={onClose}
            className="px-3 py-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-300 transition-colors"
          >
            Tutup
          </button>
        </div>
      </div>

      {/* AI Analyze Modal */}
      {showAIModal && (
        <AIAnalyzeModal
          isOpen={showAIModal}
          onClose={() => setShowAIModal(false)}
          logText={selectedLogText}
        />
      )}
    </div>
  );
}
