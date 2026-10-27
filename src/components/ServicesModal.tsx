'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import type { RunningService, ServiceScanResult } from '@/lib/services/service-detector';
import type { GitRepoInfo } from '@/lib/services/git-manager';
import VMResourceBar from './VMResourceBar';
import ServiceLogsModal from './ServiceLogsModal';
import FileEditorModal from './FileEditorModal';

interface ServicesModalProps {
  vmId: string;
  vmLabel: string;
  vmHost: string;
  onClose: () => void;
  onOpenTerminal?: (command?: string) => void;
}

type FilterType = 'all' | 'listening' | 'systemd' | 'worker' | 'docker';

interface PortTestResult {
  port: number;
  reachable: boolean;
  httpCode: number;
  responseTimeMs: number;
  status: string;
}

interface FileItem {
  name: string;
  path: string;
  isDir: boolean;
  isConfig: boolean;
  isCode?: boolean;
}

/**
 * Inline Port Tester Pill
 */
function PortTesterPill({ vmId, port }: { vmId: string; port: string }) {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<PortTestResult | null>(null);

  const testPort = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setTesting(true);
    try {
      const res = await fetch(`/api/vms/${vmId}/services/test-port`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ port }),
      });
      if (res.ok) {
        const data = await res.json();
        setResult(data);
      }
    } catch {
      // Ignore
    } finally {
      setTesting(false);
    }
  };

  return (
    <span className="inline-flex items-center gap-1">
      <span className="text-xs px-2 py-0.5 rounded-md font-mono font-semibold bg-green-100 dark:bg-green-900/60 text-green-700 dark:text-green-300">
        :{port}
      </span>
      <button
        onClick={testPort}
        disabled={testing}
        className="px-1.5 py-0.5 text-[11px] rounded bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-600 dark:text-gray-300 font-medium transition-colors"
        title={`Ping HTTP test ke port :${port}`}
      >
        {testing ? '⏳' : result ? (result.reachable ? '🟢' : '🔴') : '⚡ Ping'}
      </button>
      {result && (
        <span
          className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${
            result.httpCode >= 200 && result.httpCode < 400
              ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
              : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
          }`}
          title={`Status: ${result.status} (${result.responseTimeMs}ms)`}
        >
          {result.httpCode > 0 ? `${result.httpCode} (${result.responseTimeMs}ms)` : 'Timeout'}
        </span>
      )}
    </span>
  );
}

/**
 * Git Info & Quick Pull Block
 */
function GitInfoBlock({ vmId, workingDir }: { vmId: string; workingDir: string }) {
  const [gitInfo, setGitInfo] = useState<GitRepoInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [confirmPull, setConfirmPull] = useState(false);
  const [pullResult, setPullResult] = useState<string | null>(null);

  const fetchGitInfo = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/vms/${vmId}/services/git?path=${encodeURIComponent(workingDir)}`);
      if (res.ok) {
        const data = await res.json();
        setGitInfo(data);
      }
    } catch {
      // Ignore
    } finally {
      setLoading(false);
    }
  }, [vmId, workingDir]);

  useEffect(() => {
    fetchGitInfo();
  }, [fetchGitInfo]);

  const handlePull = async () => {
    setPulling(true);
    setConfirmPull(false);
    setPullResult(null);
    try {
      const res = await fetch(`/api/vms/${vmId}/services/git-pull`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: workingDir }),
      });
      const data = await res.json();
      setPullResult(data.output || (data.success ? 'Git pull berhasil' : 'Git pull gagal'));
      fetchGitInfo();
    } catch (err: any) {
      setPullResult(`Error: ${err.message}`);
    } finally {
      setPulling(false);
    }
  };

  if (loading) {
    return <span className="text-[11px] text-gray-400">Mengecek Git...</span>;
  }

  if (!gitInfo || !gitInfo.isRepo) {
    return null;
  }

  return (
    <div className="mt-2 p-2 rounded-md bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm">🐙</span>
          <span className="px-2 py-0.5 rounded font-mono font-semibold bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300 text-[11px]">
            🌿 {gitInfo.branch || 'main'}
          </span>
          {gitInfo.commitHash && (
            <span className="font-mono text-gray-500 text-[11px]">
              ({gitInfo.commitHash})
            </span>
          )}
          {gitInfo.commitMessage && (
            <span className="text-gray-700 dark:text-gray-300 truncate max-w-[280px]" title={gitInfo.commitMessage}>
              &quot;{gitInfo.commitMessage}&quot;
            </span>
          )}
          {gitInfo.date && (
            <span className="text-gray-400 text-[10px]">
              • {gitInfo.date}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {confirmPull ? (
            <div className="flex items-center gap-1">
              <span className="text-[11px] text-amber-600 dark:text-amber-400 font-medium">Pull origin?</span>
              <button
                onClick={handlePull}
                disabled={pulling}
                className="px-2 py-0.5 text-xs font-medium rounded bg-emerald-600 hover:bg-emerald-700 text-white"
              >
                Ya, Pull
              </button>
              <button
                onClick={() => setConfirmPull(false)}
                className="px-2 py-0.5 text-xs rounded bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300"
              >
                Batal
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmPull(true)}
              disabled={pulling}
              className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              title="Jalankan git pull pada direktori ini"
            >
              <svg className={`w-3 h-3 ${pulling ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              <span>{pulling ? 'Pulling...' : 'Git Pull'}</span>
            </button>
          )}
        </div>
      </div>

      {pullResult && (
        <div className="mt-1.5 p-1.5 bg-gray-900 text-green-400 font-mono text-[10px] rounded overflow-x-auto whitespace-pre-wrap border border-gray-800">
          {pullResult}
        </div>
      )}
    </div>
  );
}

/**
 * Project Files & Config Browser with Subfolder Navigation & Recursive Search
 */
function FolderFilesBrowser({
  vmId,
  workingDir,
  onOpenFile,
}: {
  vmId: string;
  workingDir: string;
  onOpenFile: (filePath: string) => void;
}) {
  const [currentDir, setCurrentDir] = useState<string>(workingDir);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [activeTab, setActiveTab] = useState<'folder' | 'go' | 'all'>('folder');

  // Reset currentDir when workingDir changes
  useEffect(() => {
    setCurrentDir(workingDir);
    setActiveTab('folder');
    setFilter('');
  }, [workingDir]);

  // Load files based on currentDir and activeTab
  const loadFiles = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let url = `/api/vms/${vmId}/files/list?`;
      if (activeTab === 'go') {
        url += `dir=${encodeURIComponent(workingDir)}&recursive=true&search=.go`;
      } else if (activeTab === 'all') {
        url += `dir=${encodeURIComponent(workingDir)}&recursive=true`;
      } else {
        url += `dir=${encodeURIComponent(currentDir)}`;
      }

      const res = await fetch(url);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Gagal memuat daftar file');
      }
      const data = await res.json();
      setFiles(data.files || []);
    } catch (err: any) {
      setError(err.message || 'Gagal membaca isi folder');
    } finally {
      setLoading(false);
    }
  }, [vmId, workingDir, currentDir, activeTab]);

  useEffect(() => {
    loadFiles();
  }, [loadFiles]);

  const filtered = useMemo(() => {
    if (!filter.trim()) return files;
    const q = filter.toLowerCase();
    return files.filter(
      (f) => f.name.toLowerCase().includes(q) || f.path.toLowerCase().includes(q)
    );
  }, [files, filter]);

  const configFiles = useMemo(() => files.filter((f) => f.isConfig), [files]);

  // Helper to get relative breadcrumb path from workingDir
  const relativeSubpath = useMemo(() => {
    if (currentDir === workingDir) return '';
    if (currentDir.startsWith(workingDir)) {
      return currentDir.slice(workingDir.length).replace(/^\/+/, '');
    }
    return currentDir;
  }, [currentDir, workingDir]);

  const pathSegments = useMemo(() => {
    return relativeSubpath ? relativeSubpath.split('/').filter(Boolean) : [];
  }, [relativeSubpath]);

  const handleNavigateUp = () => {
    if (currentDir === workingDir) return;
    const lastSlash = currentDir.lastIndexOf('/');
    if (lastSlash > workingDir.length) {
      setCurrentDir(currentDir.substring(0, lastSlash));
    } else {
      setCurrentDir(workingDir);
    }
  };

  const getFileBadge = (f: FileItem) => {
    const lower = f.name.toLowerCase();
    if (lower.endsWith('.go')) {
      return (
        <span className="text-[10px] px-1.5 py-0.2 rounded font-mono font-semibold bg-cyan-100 text-cyan-800 dark:bg-cyan-950 dark:text-cyan-300">
          🐹 Go
        </span>
      );
    }
    if (f.isConfig) {
      return (
        <span className="text-[10px] px-1.5 py-0.2 rounded font-mono bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300">
          ⚙️ Config
        </span>
      );
    }
    if (lower === 'dockerfile' || lower.endsWith('.dockerfile')) {
      return (
        <span className="text-[10px] px-1.5 py-0.2 rounded font-mono bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300">
          🐳 Docker
        </span>
      );
    }
    if (lower.endsWith('.mod') || lower.endsWith('.sum')) {
      return (
        <span className="text-[10px] px-1.5 py-0.2 rounded font-mono bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300">
          📦 Module
        </span>
      );
    }
    return null;
  };

  return (
    <div className="mt-2 p-2.5 rounded-md bg-gray-50 dark:bg-gray-900/80 border border-gray-200 dark:border-gray-800 text-xs">
      {/* Top Header & Tab Controls */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2 pb-2 border-b border-gray-200 dark:border-gray-800">
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setActiveTab('folder')}
            className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
              activeTab === 'folder'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 border border-gray-300 dark:border-gray-700'
            }`}
          >
            📁 Jelajahi Folder
          </button>
          <button
            onClick={() => setActiveTab('go')}
            className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium transition-colors ${
              activeTab === 'go'
                ? 'bg-cyan-600 text-white shadow-sm'
                : 'bg-white dark:bg-gray-800 text-cyan-700 dark:text-cyan-300 hover:bg-cyan-50 dark:hover:bg-cyan-950/60 border border-gray-300 dark:border-gray-700'
            }`}
            title="Tampilkan semua file .go di seluruh folder project (termasuk subfolder)"
          >
            <span>🐹</span>
            <span>Semua File .go</span>
          </button>
          <button
            onClick={() => setActiveTab('all')}
            className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
              activeTab === 'all'
                ? 'bg-purple-600 text-white shadow-sm'
                : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 border border-gray-300 dark:border-gray-700'
            }`}
            title="Tampilkan semua file dalam proyek secara rekursif"
          >
            ⚡ Semua File
          </button>
        </div>

        <div className="flex items-center gap-1.5">
          <input
            type="text"
            placeholder="Cari file (.go, json, dll)..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="text-xs px-2.5 py-1 rounded bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-gray-800 dark:text-gray-200 focus:outline-none w-44 sm:w-56"
          />
          {filter && (
            <button
              onClick={() => setFilter('')}
              className="px-1.5 py-0.5 text-xs text-gray-400 hover:text-gray-200"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Breadcrumb Navigation when in folder mode */}
      {activeTab === 'folder' && (
        <div className="flex items-center gap-1.5 text-[11px] font-mono mb-2 py-1 px-2 bg-gray-100/80 dark:bg-gray-800/80 rounded border border-gray-200 dark:border-gray-700 overflow-x-auto">
          {currentDir !== workingDir && (
            <button
              onClick={handleNavigateUp}
              className="flex items-center gap-1 px-2 py-0.5 text-[10px] rounded bg-white dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 font-sans font-semibold border border-gray-300 dark:border-gray-600 transition-colors flex-shrink-0"
              title="Kembali ke folder sebelumnya (parent directory)"
            >
              ⬅ Ke Atas (..)
            </button>
          )}

          <button
            onClick={() => setCurrentDir(workingDir)}
            className="flex items-center gap-1 font-semibold text-blue-600 dark:text-blue-400 hover:underline flex-shrink-0"
            title="Kembali ke root folder project"
          >
            <span>🏠</span>
            <span>{workingDir.split('/').filter(Boolean).pop() || 'root'}</span>
          </button>

          {pathSegments.map((segment, idx) => {
            const segmentPath =
              workingDir.replace(/\/+$/, '') +
              '/' +
              pathSegments.slice(0, idx + 1).join('/');
            const isLast = idx === pathSegments.length - 1;

            return (
              <span key={segmentPath} className="flex items-center gap-1 flex-shrink-0">
                <span className="text-gray-400">/</span>
                {isLast ? (
                  <span className="font-bold text-gray-900 dark:text-gray-100 bg-blue-100/60 dark:bg-blue-950 px-1 rounded">
                    {segment}
                  </span>
                ) : (
                  <button
                    onClick={() => setCurrentDir(segmentPath)}
                    className="text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    {segment}
                  </button>
                )}
              </span>
            );
          })}
        </div>
      )}

      {/* State indicators */}
      {loading && (
        <div className="py-3 flex items-center justify-center gap-2 text-gray-500 dark:text-gray-400 text-xs italic">
          <svg className="w-4 h-4 animate-spin text-blue-500" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <span>Memuat file dari remote server...</span>
        </div>
      )}

      {error && (
        <div className="p-2 mb-2 rounded bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 text-xs">
          ⚠️ {error}
        </div>
      )}

      {/* Quick Config Shortcuts in root folder */}
      {!loading && configFiles.length > 0 && activeTab === 'folder' && currentDir === workingDir && !filter && (
        <div className="mb-2">
          <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-1 font-medium">
            File Konfigurasi Utama (Klik untuk edit):
          </p>
          <div className="flex flex-wrap gap-1.5">
            {configFiles.map((f) => (
              <button
                key={f.path}
                onClick={() => onOpenFile(f.path)}
                className="flex items-center gap-1 px-2.5 py-1 rounded bg-amber-50 dark:bg-amber-950/70 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200 hover:bg-amber-100 dark:hover:bg-amber-900 font-mono text-xs transition-colors"
                title={`Buka & edit ${f.name} di web editor`}
              >
                <span>⚙️</span>
                <strong>{f.name}</strong>
                <span className="text-[10px] text-amber-600 dark:text-amber-400 ml-1">✏️ Edit</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* File & Folder List */}
      {!loading && !error && filtered.length === 0 && (
        <p className="text-gray-400 py-3 text-center italic text-xs">
          {filter ? 'Tidak ada file yang cocok dengan pencarian.' : 'Folder ini kosong.'}
        </p>
      )}

      {!loading && filtered.length > 0 && (
        <div className="max-h-56 overflow-y-auto space-y-1 pr-1 font-mono text-[11px] border-t border-gray-100 dark:border-gray-800/60 pt-1.5 divide-y divide-gray-100 dark:divide-gray-800/40">
          {filtered.map((f) => (
            <div
              key={f.path}
              className="flex items-center justify-between p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors gap-2"
            >
              {f.isDir ? (
                // Folder Row -> Clickable to drill down into subfolder
                <button
                  onClick={() => setCurrentDir(f.path)}
                  className="flex items-center gap-2 text-left group hover:text-blue-500 transition-colors w-full min-w-0"
                  title={`Buka folder ${f.name}`}
                >
                  <span className="text-base flex-shrink-0">📁</span>
                  <span className="font-semibold text-gray-800 dark:text-gray-200 group-hover:underline truncate">
                    {f.name}
                  </span>
                  <span className="ml-auto flex-shrink-0 text-[10px] px-2 py-0.5 rounded bg-gray-200/70 dark:bg-gray-700/70 text-gray-600 dark:text-gray-300 group-hover:bg-blue-600 group-hover:text-white font-sans font-medium transition-colors">
                    Buka ➔
                  </span>
                </button>
              ) : (
                // File Row -> Shows badge & ✏️ Edit button
                <>
                  <div className="flex items-center gap-1.5 truncate min-w-0">
                    <span className="flex-shrink-0">
                      {f.name.endsWith('.go') ? '🐹' : f.isConfig ? '⚙️' : f.name === 'Dockerfile' ? '🐳' : '📄'}
                    </span>
                    <span
                      className={`truncate ${
                        f.name.endsWith('.go')
                          ? 'font-semibold text-cyan-700 dark:text-cyan-300'
                          : f.isConfig
                          ? 'font-semibold text-amber-700 dark:text-amber-300'
                          : 'text-gray-700 dark:text-gray-300'
                      }`}
                      title={f.path}
                    >
                      {f.name}
                    </span>
                    {getFileBadge(f)}
                  </div>

                  <button
                    onClick={() => onOpenFile(f.path)}
                    className="flex-shrink-0 flex items-center gap-1 px-2.5 py-0.5 rounded bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900 border border-blue-200 dark:border-blue-900 font-sans text-[11px] font-medium transition-colors"
                    title={`Edit ${f.name} dengan Web Code Editor`}
                  >
                    <span>✏️</span>
                    <span>Edit</span>
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ServicesModal({
  vmId,
  vmLabel,
  vmHost,
  onClose,
  onOpenTerminal,
}: ServicesModalProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [services, setServices] = useState<RunningService[]>([]);
  const [scannedAt, setScannedAt] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<FilterType>('all');
  const [copiedPath, setCopiedPath] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedFolderId, setExpandedFolderId] = useState<string | null>(null);

  // Feature 1: Action state
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionConfirm, setActionConfirm] = useState<{ serviceName: string; action: 'restart' | 'stop' | 'start' } | null>(null);
  const [actionMessage, setActionMessage] = useState<{ text: string; success: boolean } | null>(null);

  // Feature 2: Service Logs modal state
  const [selectedLogsUnit, setSelectedLogsUnit] = useState<string | null>(null);

  // Web File Editor state (Option 2)
  const [selectedEditFilePath, setSelectedEditFilePath] = useState<string | null>(null);

  const fetchServices = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/vms/${vmId}/services`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}: Failed to fetch services`);
      }
      const data: ServiceScanResult = await res.json();
      setServices(data.services || []);
      setScannedAt(data.scannedAt || new Date().toISOString());
    } catch (err: any) {
      setError(err.message || 'Gagal mengambil data service.');
    } finally {
      setLoading(false);
    }
  }, [vmId]);

  useEffect(() => {
    fetchServices();
  }, [fetchServices]);

  const handleCopy = useCallback((text: string) => {
    if (navigator?.clipboard) {
      navigator.clipboard.writeText(text);
      setCopiedPath(text);
      setTimeout(() => {
        setCopiedPath(null);
      }, 2000);
    }
  }, []);

  const handleServiceAction = async (serviceName: string, action: 'restart' | 'stop' | 'start') => {
    setActionLoading(`${serviceName}:${action}`);
    setActionConfirm(null);
    setActionMessage(null);
    try {
      const res = await fetch(`/api/vms/${vmId}/services/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serviceName, action }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setActionMessage({ text: `Berhasil ${action} service ${serviceName}`, success: true });
        // Refresh services after 1.5 seconds to reflect new status
        setTimeout(() => fetchServices(), 1500);
      } else {
        setActionMessage({ text: data.error || `Gagal ${action} service`, success: false });
      }
    } catch (err: any) {
      setActionMessage({ text: err.message || 'Terjadi kesalahan sistem', success: false });
    } finally {
      setActionLoading(null);
      setTimeout(() => setActionMessage(null), 5000);
    }
  };

  const counts = useMemo(() => {
    const total = services.length;
    const listening = services.filter((s) => s.type === 'listening').length;
    const systemd = services.filter((s) => s.type === 'systemd').length;
    const workers = services.filter((s) => s.type === 'worker').length;
    const docker = services.filter((s) => s.type === 'docker').length;
    return { total, listening, systemd, workers, docker };
  }, [services]);

  const filteredServices = useMemo(() => {
    return services.filter((s) => {
      if (activeFilter !== 'all' && s.type !== activeFilter) return false;
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return (
        s.name.toLowerCase().includes(q) ||
        s.ports.some((p) => p.includes(q) || `:${p}`.includes(q)) ||
        s.workingDir?.toLowerCase().includes(q) ||
        s.execPath?.toLowerCase().includes(q) ||
        s.unitFile?.toLowerCase().includes(q) ||
        s.user?.toLowerCase().includes(q) ||
        (s.pid ? String(s.pid).includes(q) : false) ||
        s.description?.toLowerCase().includes(q)
      );
    });
  }, [services, activeFilter, searchQuery]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 md:p-6"
      data-testid="services-modal"
    >
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      <div className="relative w-full max-w-5xl h-[92vh] bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-2xl flex flex-col overflow-hidden z-10">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-3.5 border-b border-gray-200 dark:border-gray-800 bg-gray-50/80 dark:bg-gray-800/80">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="p-1.5 rounded-lg bg-blue-100 dark:bg-blue-900/60 text-blue-600 dark:text-blue-400">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01"
                  />
                </svg>
              </span>
              <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">
                Running Services & Paths
              </h2>
              <span className="text-xs px-2.5 py-0.5 rounded-full font-medium bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300">
                {vmLabel} ({vmHost})
              </span>
            </div>
            {scannedAt && (
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                Terakhir dipindai: {new Date(scannedAt).toLocaleTimeString()} WIB ({new Date(scannedAt).toLocaleDateString()})
              </p>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={fetchServices}
              disabled={loading}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
              title="Pindai ulang services"
            >
              <svg
                className={`w-4 h-4 ${loading ? 'animate-spin text-blue-600' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
              Refresh
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              aria-label="Tutup"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Feature 3: Server Resource Monitoring Banner */}
        <div className="px-6 py-2.5 bg-gray-50/60 dark:bg-gray-800/40 border-b border-gray-200 dark:border-gray-800">
          <VMResourceBar vmId={vmId} isOnline={true} compact={false} />
        </div>

        {/* Toast Notification for Actions */}
        {actionMessage && (
          <div
            className={`px-4 py-2 text-xs font-medium flex items-center justify-between ${
              actionMessage.success
                ? 'bg-emerald-50 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-200 border-b border-emerald-200 dark:border-emerald-800'
                : 'bg-red-50 dark:bg-red-950 text-red-800 dark:text-red-200 border-b border-red-200 dark:border-red-800'
            }`}
          >
            <span>{actionMessage.text}</span>
            <button onClick={() => setActionMessage(null)} className="underline ml-2">
              Tutup
            </button>
          </div>
        )}

        {/* Search & Filter Bar */}
        <div className="p-4 border-b border-gray-200 dark:border-gray-800 flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between">
          <div className="relative flex-1">
            <svg
              className="absolute left-3 top-2.5 w-4 h-4 text-gray-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="Cari service, port (contoh :8080), folder path, atau binary..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2 text-sm bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 md:pb-0">
            <button
              onClick={() => setActiveFilter('all')}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg whitespace-nowrap transition-colors ${
                activeFilter === 'all'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
              }`}
            >
              Semua ({counts.total})
            </button>
            <button
              onClick={() => setActiveFilter('listening')}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg whitespace-nowrap transition-colors ${
                activeFilter === 'listening'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
              }`}
            >
              Ports / Apps ({counts.listening})
            </button>
            <button
              onClick={() => setActiveFilter('systemd')}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg whitespace-nowrap transition-colors ${
                activeFilter === 'systemd'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
              }`}
            >
              Systemd ({counts.systemd})
            </button>
            <button
              onClick={() => setActiveFilter('worker')}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg whitespace-nowrap transition-colors ${
                activeFilter === 'worker'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
              }`}
            >
              Workers ({counts.workers})
            </button>
            {counts.docker > 0 && (
              <button
                onClick={() => setActiveFilter('docker')}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg whitespace-nowrap transition-colors ${
                  activeFilter === 'docker'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                }`}
              >
                Docker ({counts.docker})
              </button>
            )}
          </div>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-3">
          {loading && (
            <div className="flex flex-col items-center justify-center py-20 text-gray-500 dark:text-gray-400">
              <svg className="w-8 h-8 animate-spin text-blue-600 mb-3" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              <p className="text-sm font-medium">Memindai service & path pada VM...</p>
            </div>
          )}

          {!loading && error && (
            <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg p-4 text-sm text-red-700 dark:text-red-300">
              <p className="font-semibold">Gagal memindai service: {error}</p>
              <button
                onClick={fetchServices}
                className="mt-3 px-3 py-1.5 text-xs font-medium text-white bg-red-600 hover:bg-red-700 rounded-md transition-colors"
              >
                Coba Lagi
              </button>
            </div>
          )}

          {!loading && !error && filteredServices.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-center text-gray-500 dark:text-gray-400">
              <p className="text-sm font-medium">Tidak ada service yang cocok dengan filter.</p>
            </div>
          )}

          {!loading &&
            !error &&
            filteredServices.map((service) => {
              const isExpanded = expandedId === service.id;
              const isFolderOpen = expandedFolderId === service.id;

              // Extract clean systemd unit name if available
              const unitName = service.unitFile
                ? service.unitFile.split('/').pop()
                : service.name.endsWith('.service')
                ? service.name
                : null;

              return (
                <div
                  key={service.id}
                  className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4 hover:border-gray-300 dark:hover:border-gray-600 transition-all shadow-sm"
                >
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      {/* Name, Badges & Port Tester */}
                      <div className="flex items-center flex-wrap gap-2 mb-1.5">
                        <span className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-500" title="Running" />
                        <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 font-mono truncate">
                          {service.name}
                        </h3>

                        {/* Type badge */}
                        <span
                          className={`text-xs px-2 py-0.5 rounded-md font-medium uppercase tracking-wider ${
                            service.type === 'listening'
                              ? 'bg-blue-100 dark:bg-blue-900/60 text-blue-700 dark:text-blue-300'
                              : service.type === 'systemd'
                              ? 'bg-purple-100 dark:bg-purple-900/60 text-purple-700 dark:text-purple-300'
                              : service.type === 'docker'
                              ? 'bg-cyan-100 dark:bg-cyan-900/60 text-cyan-700 dark:text-cyan-300'
                              : 'bg-amber-100 dark:bg-amber-900/60 text-amber-700 dark:text-amber-300'
                          }`}
                        >
                          {service.type}
                        </span>

                        {/* Feature 4: Port Badges with Ping / Curl Tester */}
                        {service.ports && service.ports.length > 0 && (
                          <div className="flex items-center gap-1.5">
                            {service.ports.map((port) => (
                              <PortTesterPill key={port} vmId={vmId} port={port} />
                            ))}
                          </div>
                        )}

                        {service.pid && (
                          <span className="text-xs font-mono text-gray-500 dark:text-gray-400">
                            PID: {service.pid}
                          </span>
                        )}

                        {service.user && (
                          <span className="text-xs text-gray-500 dark:text-gray-400">
                            User: <strong className="font-mono text-gray-700 dark:text-gray-300">{service.user}</strong>
                          </span>
                        )}
                      </div>

                      {service.description && (
                        <p className="text-xs text-gray-500 dark:text-gray-400 mb-2.5">
                          {service.description}
                        </p>
                      )}

                      {/* Paths Grid */}
                      <div className="space-y-1.5 text-xs mt-3">
                        {/* Working Directory / Project Folder */}
                        {service.workingDir && (
                          <div>
                            <div className="flex items-center justify-between gap-2 bg-gray-50 dark:bg-gray-900/60 p-2 rounded-md border border-gray-100 dark:border-gray-800">
                              <div className="flex items-center gap-1.5 min-w-0">
                                <span className="text-base flex-shrink-0" title="Working Directory">📁</span>
                                <span className="text-gray-400 font-medium flex-shrink-0">Path Folder:</span>
                                <span className="font-mono text-gray-800 dark:text-gray-200 truncate select-all">
                                  {service.workingDir}
                                </span>
                              </div>
                              <div className="flex items-center gap-1 flex-shrink-0">
                                {/* Option 2: Browse & Edit Config Files */}
                                <button
                                  onClick={() => setExpandedFolderId(isFolderOpen ? null : service.id)}
                                  className={`px-2 py-1 text-xs rounded font-medium transition-colors flex items-center gap-1 ${
                                    isFolderOpen
                                      ? 'bg-amber-600 text-white'
                                      : 'bg-amber-50 dark:bg-amber-950/60 hover:bg-amber-100 dark:hover:bg-amber-900 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300'
                                  }`}
                                  title="Buka daftar file & config di folder ini"
                                >
                                  <span>📄</span>
                                  <span>{isFolderOpen ? 'Tutup Files' : 'Config / Files'}</span>
                                </button>

                                <button
                                  onClick={() => handleCopy(service.workingDir!)}
                                  className="px-2 py-1 text-xs rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 font-medium transition-colors"
                                  title="Salin folder path"
                                >
                                  {copiedPath === service.workingDir ? '✓ Tersalin' : 'Salin'}
                                </button>

                                {onOpenTerminal && (
                                  <button
                                    onClick={() => {
                                      if (service.workingDir) {
                                        try {
                                          localStorage.setItem(`terminal-lastdir-${vmId}`, service.workingDir);
                                        } catch {
                                          // Ignore
                                        }
                                      }
                                      onOpenTerminal(`cd "${service.workingDir}"`);
                                    }}
                                    className="px-2 py-1 text-xs rounded bg-blue-50 dark:bg-blue-900/50 hover:bg-blue-100 dark:hover:bg-blue-800 text-blue-600 dark:text-blue-300 font-medium transition-colors flex items-center gap-1"
                                    title="Buka terminal dan masuk ke folder ini"
                                  >
                                    <span>💻</span> Terminal
                                  </button>
                                )}
                              </div>
                            </div>

                            {/* Option 2: Folder Files Browser */}
                            {isFolderOpen && (
                              <FolderFilesBrowser
                                vmId={vmId}
                                workingDir={service.workingDir}
                                onOpenFile={(filePath) => setSelectedEditFilePath(filePath)}
                              />
                            )}

                            {/* Feature 5: Git Info & Quick Pull */}
                            <GitInfoBlock vmId={vmId} workingDir={service.workingDir} />
                          </div>
                        )}

                        {/* Executable Path */}
                        {service.execPath && (
                          <div className="flex items-center justify-between gap-2 bg-gray-50 dark:bg-gray-900/60 p-2 rounded-md border border-gray-100 dark:border-gray-800">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className="text-base flex-shrink-0" title="Executable Binary">⚙️</span>
                              <span className="text-gray-400 font-medium flex-shrink-0">Binary:</span>
                              <span className="font-mono text-gray-800 dark:text-gray-200 truncate select-all">
                                {service.execPath}
                              </span>
                            </div>
                            <button
                              onClick={() => handleCopy(service.execPath!)}
                              className="px-2 py-1 text-xs rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 font-medium flex-shrink-0 transition-colors"
                              title="Salin executable path"
                            >
                              {copiedPath === service.execPath ? '✓ Tersalin' : 'Salin'}
                            </button>
                          </div>
                        )}

                        {/* Unit File & Service Controls */}
                        {service.unitFile && (
                          <div className="flex items-center justify-between gap-2 bg-gray-50 dark:bg-gray-900/60 p-2 rounded-md border border-gray-100 dark:border-gray-800">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className="text-base flex-shrink-0" title="Systemd Unit File">📄</span>
                              <span className="text-gray-400 font-medium flex-shrink-0">Unit File:</span>
                              <span className="font-mono text-gray-800 dark:text-gray-200 truncate select-all">
                                {service.unitFile}
                              </span>
                            </div>
                            <div className="flex items-center gap-1 flex-shrink-0">
                              {/* Option 2: Edit Unit File in Web Editor */}
                              <button
                                onClick={() => setSelectedEditFilePath(service.unitFile!)}
                                className="px-2 py-1 text-xs rounded bg-purple-50 dark:bg-purple-950/60 hover:bg-purple-100 dark:hover:bg-purple-900 border border-purple-200 dark:border-purple-800 text-purple-700 dark:text-purple-300 font-medium transition-colors flex items-center gap-1"
                                title="Edit unit file ini di web editor"
                              >
                                <span>✏️</span>
                                <span>Edit</span>
                              </button>

                              <button
                                onClick={() => handleCopy(service.unitFile!)}
                                className="px-2 py-1 text-xs rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 font-medium transition-colors"
                                title="Salin unit file path"
                              >
                                {copiedPath === service.unitFile ? '✓ Tersalin' : 'Salin'}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Expandable Command Line */}
                      {service.cmdline && (
                        <div className="mt-2.5">
                          <button
                            onClick={() => setExpandedId(isExpanded ? null : service.id)}
                            className="text-xs text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
                          >
                            <span>{isExpanded ? 'Sembunyikan Command Line' : 'Lihat Command Line Lengkap'}</span>
                            <svg
                              className={`w-3.5 h-3.5 transform transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                          </button>
                          {isExpanded && (
                            <div className="mt-1.5 p-2.5 bg-gray-900 text-green-400 font-mono text-xs rounded-lg overflow-x-auto select-all border border-gray-800">
                              {service.cmdline}
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Feature 1 & 2: Quick Service Actions Column */}
                    {unitName && (
                      <div className="flex flex-row sm:flex-col items-end gap-1.5 flex-shrink-0 pt-1 sm:pt-0">
                        {/* Feature 2: Quick Logs Button */}
                        <button
                          onClick={() => setSelectedLogsUnit(unitName)}
                          className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 transition-colors"
                          title="Lihat live log journalctl"
                        >
                          <span>📄</span>
                          <span>Logs</span>
                        </button>

                        {/* Feature 1: Restart Button */}
                        <button
                          onClick={() => setActionConfirm({ serviceName: unitName, action: 'restart' })}
                          disabled={actionLoading === `${unitName}:restart`}
                          className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded bg-amber-50 dark:bg-amber-950/60 hover:bg-amber-100 dark:hover:bg-amber-900 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300 transition-colors disabled:opacity-50"
                          title="Restart service via systemctl"
                        >
                          <svg className={`w-3 h-3 ${actionLoading === `${unitName}:restart` ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                          </svg>
                          <span>Restart</span>
                        </button>

                        {/* Stop/Start toggle */}
                        <button
                          onClick={() => setActionConfirm({ serviceName: unitName, action: service.status === 'running' || service.status === 'active' ? 'stop' : 'start' })}
                          className="px-2 py-0.5 text-[11px] text-gray-500 hover:text-red-500 transition-colors"
                        >
                          {service.status === 'running' || service.status === 'active' ? 'Stop service' : 'Start service'}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-gray-200 dark:border-gray-800 bg-gray-50/80 dark:bg-gray-800/80 flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
          <span>Menampilkan {filteredServices.length} dari {services.length} services</span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 font-medium text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"
          >
            Tutup
          </button>
        </div>
      </div>

      {/* Confirmation Modal for Service Actions (Restart/Stop) */}
      {actionConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-5 max-w-sm w-full shadow-2xl border border-gray-200 dark:border-gray-700">
            <h3 className="text-base font-bold text-gray-900 dark:text-gray-100 mb-2">
              Konfirmasi {actionConfirm.action.toUpperCase()}
            </h3>
            <p className="text-xs text-gray-600 dark:text-gray-400 mb-4">
              Apakah Anda yakin ingin menjalankan <strong>systemctl {actionConfirm.action} {actionConfirm.serviceName}</strong>?
            </p>
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => setActionConfirm(null)}
                className="px-3 py-1.5 text-xs font-medium rounded bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200"
              >
                Batal
              </button>
              <button
                onClick={() => handleServiceAction(actionConfirm.serviceName, actionConfirm.action)}
                className="px-3 py-1.5 text-xs font-medium rounded bg-amber-600 hover:bg-amber-700 text-white"
              >
                Ya, {actionConfirm.action}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Feature 2: Service Logs Modal */}
      {selectedLogsUnit && (
        <ServiceLogsModal
          vmId={vmId}
          vmLabel={vmLabel}
          unitName={selectedLogsUnit}
          onClose={() => setSelectedLogsUnit(null)}
        />
      )}

      {/* Web File Editor Modal (Option 2) */}
      {selectedEditFilePath && (
        <FileEditorModal
          vmId={vmId}
          vmLabel={vmLabel}
          filePath={selectedEditFilePath}
          onClose={() => setSelectedEditFilePath(null)}
          onSaved={() => {
            if (selectedEditFilePath.endsWith('.service')) {
              fetchServices();
            }
          }}
        />
      )}
    </div>
  );
}
