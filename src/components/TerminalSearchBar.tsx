'use client';

import { useState, useRef, useEffect } from 'react';

interface SearchPreset {
  id: string;
  label: string;
  description: string;
  icon: string;
  buildCommand: (keyword: string, logFile: string) => string;
  placeholder: string;
  needsKeyword: boolean;
}

const SEARCH_PRESETS: SearchPreset[] = [
  {
    id: 'grep-keyword',
    label: 'Search Keyword',
    description: 'Cari keyword dengan highlight warna',
    icon: '🔍',
    buildCommand: (keyword, logFile) =>
      `grep --color=always -in "${keyword}" ${logFile}`,
    placeholder: 'error|warning|timeout',
    needsKeyword: true,
  },
  {
    id: 'tail-grep',
    label: 'Live Tail + Search',
    description: 'Monitor real-time + filter (Ctrl+C stop)',
    icon: '📡',
    buildCommand: (keyword, logFile) =>
      `tail -f ${logFile} | grep --color=always --line-buffered -i "${keyword}"`,
    placeholder: 'error|fatal|panic',
    needsKeyword: true,
  },
  {
    id: 'grep-context',
    label: 'Search + Context (±5 lines)',
    description: 'Keyword + 5 baris sebelum & sesudah',
    icon: '📋',
    buildCommand: (keyword, logFile) =>
      `grep --color=always -in -B5 -A5 "${keyword}" ${logFile}`,
    placeholder: 'exception|stack|trace',
    needsKeyword: true,
  },
  {
    id: 'grep-count',
    label: 'Count Occurrences',
    description: 'Hitung jumlah kemunculan',
    icon: '🔢',
    buildCommand: (keyword, logFile) =>
      `grep -ic "${keyword}" ${logFile}`,
    placeholder: 'error|404|500',
    needsKeyword: true,
  },
  {
    id: 'grep-multi',
    label: 'Multiple Keywords (OR)',
    description: 'Cari beberapa keyword sekaligus',
    icon: '🎯',
    buildCommand: (keyword, logFile) =>
      `grep --color=always -inE "${keyword}" ${logFile}`,
    placeholder: 'error|warning|fatal (pisah |)',
    needsKeyword: true,
  },
  {
    id: 'grep-exclude',
    label: 'Exclude Keyword',
    description: 'Tampilkan semua KECUALI keyword',
    icon: '🚫',
    buildCommand: (keyword, logFile) =>
      `grep --color=always -inv "${keyword}" ${logFile}`,
    placeholder: 'DEBUG|INFO|health_check',
    needsKeyword: true,
  },
  {
    id: 'grep-timestamp',
    label: 'Search by Time',
    description: 'Filter berdasarkan waktu',
    icon: '🕐',
    buildCommand: (keyword, logFile) =>
      `grep --color=always -in "${keyword}" ${logFile}`,
    placeholder: '2026-05-07 10:|15:30',
    needsKeyword: true,
  },
  {
    id: 'grep-errors',
    label: 'Errors Only',
    description: 'Filter ERROR/FATAL/PANIC/CRITICAL',
    icon: '🔴',
    buildCommand: (_keyword, logFile) =>
      `grep --color=always -inE "(error|fatal|panic|critical)" ${logFile}`,
    placeholder: '(otomatis)',
    needsKeyword: false,
  },
  {
    id: 'grep-warnings',
    label: 'Warnings Only',
    description: 'Filter WARNING/WARN',
    icon: '🟡',
    buildCommand: (_keyword, logFile) =>
      `grep --color=always -inE "(warn|warning)" ${logFile}`,
    placeholder: '(otomatis)',
    needsKeyword: false,
  },
  {
    id: 'tail-lines',
    label: 'Last N Lines',
    description: 'Tampilkan N baris terakhir',
    icon: '📄',
    buildCommand: (keyword, logFile) =>
      `tail -n ${keyword || '100'} ${logFile}`,
    placeholder: '100',
    needsKeyword: true,
  },
  {
    id: 'tail-live',
    label: 'Live Tail (All)',
    description: 'Monitor semua output (Ctrl+C stop)',
    icon: '🔄',
    buildCommand: (_keyword, logFile) =>
      `tail -f ${logFile}`,
    placeholder: '(otomatis)',
    needsKeyword: false,
  },
  {
    id: 'top-errors',
    label: 'Top Errors (Ranking)',
    description: 'Error paling sering muncul',
    icon: '🏆',
    buildCommand: (keyword, logFile) =>
      `grep -i "${keyword || 'error'}" ${logFile} | sort | uniq -c | sort -rn | head -20`,
    placeholder: 'error|fatal',
    needsKeyword: true,
  },
  {
    id: 'grep-http',
    label: 'HTTP Status Codes',
    description: 'Cari 4xx, 5xx response codes',
    icon: '🌐',
    buildCommand: (keyword, logFile) =>
      `grep --color=always -inE "\\b(${keyword})\\b" ${logFile}`,
    placeholder: '500|502|503|404',
    needsKeyword: true,
  },
  {
    id: 'cat-file',
    label: 'View File (cat)',
    description: 'Lihat seluruh isi file',
    icon: '👁️',
    buildCommand: (_keyword, logFile) =>
      `cat ${logFile}`,
    placeholder: '(otomatis)',
    needsKeyword: false,
  },
  {
    id: 'head-file',
    label: 'Head (First N lines)',
    description: 'Lihat N baris pertama file',
    icon: '⬆️',
    buildCommand: (keyword, logFile) =>
      `head -n ${keyword || '50'} ${logFile}`,
    placeholder: '50',
    needsKeyword: true,
  },
  {
    id: 'less-file',
    label: 'Less (Scrollable)',
    description: 'Buka file dengan scroll (q untuk keluar)',
    icon: '📖',
    buildCommand: (_keyword, logFile) =>
      `less ${logFile}`,
    placeholder: '(otomatis)',
    needsKeyword: false,
  },
  {
    id: 'cd-dir',
    label: 'CD (Pindah Folder)',
    description: 'Pindah ke folder yang sedang dibuka di file browser',
    icon: '📂',
    buildCommand: (_keyword, logFile) =>
      `cd ${logFile}`,
    placeholder: '(pilih folder dari file browser)',
    needsKeyword: false,
  },
];

interface DirEntry {
  name: string;
  isDir: boolean;
  path: string;
}

interface TerminalSearchBarProps {
  onExecute: (command: string) => void;
  visible: boolean;
  onToggle: () => void;
  dirEntries: DirEntry[];
  currentDir: string;
  loadingLogs: boolean;
  onNavigate: (dir?: string) => void;
}

export default function TerminalSearchBar({
  onExecute,
  visible,
  onToggle,
  dirEntries,
  currentDir,
  loadingLogs,
  onNavigate,
}: TerminalSearchBarProps) {
  const [selectedPreset, setSelectedPreset] = useState<SearchPreset | null>(null);
  const [keyword, setKeyword] = useState('');
  const [selectedFile, setSelectedFile] = useState('');
  const [showPresets, setShowPresets] = useState(false);
  const [showFileBrowser, setShowFileBrowser] = useState(false);
  const [filter, setFilter] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);
  const fileDropdownRef = useRef<HTMLDivElement>(null);
  const keywordInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowPresets(false);
      }
      if (fileDropdownRef.current && !fileDropdownRef.current.contains(event.target as Node)) {
        setShowFileBrowser(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (selectedPreset?.needsKeyword && keywordInputRef.current) {
      keywordInputRef.current.focus();
    }
  }, [selectedPreset]);

  const handleSelectPreset = (preset: SearchPreset) => {
    setSelectedPreset(preset);
    setShowPresets(false);
    setKeyword('');
  };

  const handleSelectFile = (entry: DirEntry) => {
    if (entry.isDir) {
      // Navigate into directory
      onNavigate(entry.path);
      setFilter('');
    } else {
      // Select file
      setSelectedFile(entry.path);
      setShowFileBrowser(false);
      setFilter('');
    }
  };

  const handleGoUp = () => {
    const parent = currentDir.split('/').slice(0, -1).join('/') || '/';
    onNavigate(parent);
    setFilter('');
  };

  const handleExecute = () => {
    if (!selectedPreset) return;

    // For cd-dir, use currentDir instead of selectedFile
    if (selectedPreset.id === 'cd-dir') {
      if (!currentDir) return;
      const command = `cd ${currentDir}`;
      onExecute(command);
      return;
    }

    if (!selectedFile) return;
    const command = selectedPreset.buildCommand(keyword, selectedFile);
    onExecute(command);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && canExecute) {
      handleExecute();
    }
    if (e.key === 'Escape') {
      onToggle();
    }
  };

  const filteredEntries = filter
    ? dirEntries.filter((e) => e.name.toLowerCase().includes(filter.toLowerCase()))
    : dirEntries;

  // Sort: directories first, then files
  const sortedEntries = [...filteredEntries].sort((a, b) => {
    if (a.isDir && !b.isDir) return -1;
    if (!a.isDir && b.isDir) return 1;
    return a.name.localeCompare(b.name);
  });

  const getFileName = (path: string) => path.split('/').pop() || path;

  const canExecute = selectedPreset && (
    selectedPreset.id === 'cd-dir'
      ? !!currentDir
      : selectedFile && (selectedPreset.needsKeyword ? keyword.trim() : true)
  );

  if (!visible) return null;

  return (
    <div className="bg-gray-800 border-b border-gray-700 px-3 py-2">
      <div className="flex items-center gap-2 flex-wrap">
        {/* Preset selector */}
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => setShowPresets(!showPresets)}
            className="flex items-center gap-2 px-3 py-1.5 text-sm bg-gray-700 hover:bg-gray-600 text-gray-200 rounded-md border border-gray-600 transition-colors min-w-[180px]"
          >
            <svg className="w-4 h-4 text-blue-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <span className="truncate flex-1 text-left">
              {selectedPreset ? `${selectedPreset.icon} ${selectedPreset.label}` : 'Jenis Search...'}
            </span>
            <svg className="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {showPresets && (
            <div className="absolute top-full left-0 mt-1 w-[340px] max-h-[380px] overflow-y-auto bg-gray-800 border border-gray-600 rounded-lg shadow-xl z-50">
              {SEARCH_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  onClick={() => handleSelectPreset(preset)}
                  className={`w-full text-left px-3 py-2 hover:bg-gray-700 transition-colors border-b border-gray-700/40 last:border-0 ${
                    selectedPreset?.id === preset.id ? 'bg-blue-900/30' : ''
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-base">{preset.icon}</span>
                    <div>
                      <p className="text-sm text-gray-200 font-medium">{preset.label}</p>
                      <p className="text-xs text-gray-400">{preset.description}</p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* File browser */}
        <div className="relative" ref={fileDropdownRef}>
          <button
            onClick={() => setShowFileBrowser(!showFileBrowser)}
            className="flex items-center gap-2 px-3 py-1.5 text-sm bg-gray-700 hover:bg-gray-600 text-gray-200 rounded-md border border-gray-600 transition-colors min-w-[180px] max-w-[280px]"
          >
            <svg className="w-4 h-4 text-green-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <span className="truncate flex-1 text-left">
              {selectedFile ? getFileName(selectedFile) : 'Pilih File...'}
            </span>
            {loadingLogs && (
              <div className="w-3 h-3 border border-blue-400 border-t-transparent rounded-full animate-spin flex-shrink-0" />
            )}
            <svg className="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {showFileBrowser && (
            <div className="absolute top-full left-0 mt-1 w-[420px] max-h-[380px] bg-gray-800 border border-gray-600 rounded-lg shadow-xl z-50 flex flex-col">
              {/* Current path + filter */}
              <div className="p-2 border-b border-gray-700 space-y-1.5">
                <div className="flex items-center gap-1.5 text-xs text-gray-400 font-mono">
                  <span className="truncate">{currentDir}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={handleGoUp}
                    disabled={currentDir === '/'}
                    className="px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 disabled:opacity-40 text-gray-300 rounded transition-colors"
                  >
                    ↑ Up
                  </button>
                  <input
                    type="text"
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    placeholder="Filter..."
                    className="flex-1 px-2 py-1 text-sm bg-gray-900 border border-gray-600 rounded text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500"
                    autoFocus
                  />
                </div>
              </div>

              {/* Entries */}
              <div className="overflow-y-auto flex-1">
                {loadingLogs && (
                  <div className="p-3 text-center text-gray-400 text-sm">
                    <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin mx-auto mb-1" />
                    Loading...
                  </div>
                )}
                {!loadingLogs && sortedEntries.length === 0 && (
                  <div className="p-3 text-center text-gray-500 text-sm">Kosong</div>
                )}
                {!loadingLogs && sortedEntries.map((entry) => (
                  <button
                    key={entry.path}
                    onClick={() => handleSelectFile(entry)}
                    className={`w-full text-left px-3 py-1.5 hover:bg-gray-700 transition-colors flex items-center gap-2 border-b border-gray-700/30 ${
                      selectedFile === entry.path ? 'bg-blue-900/30' : ''
                    }`}
                  >
                    {entry.isDir ? (
                      <svg className="w-4 h-4 text-yellow-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                      </svg>
                    ) : (
                      <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                    )}
                    <span className={`text-sm font-mono truncate ${entry.isDir ? 'text-yellow-300' : 'text-gray-200'}`}>
                      {entry.name}{entry.isDir ? '/' : ''}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Keyword input */}
        {selectedPreset?.needsKeyword && (
          <input
            ref={keywordInputRef}
            type="text"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={selectedPreset.placeholder}
            className="flex-1 min-w-[130px] px-3 py-1.5 text-sm bg-gray-900 border border-gray-600 rounded-md text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500"
          />
        )}

        {/* Run */}
        <button
          onClick={handleExecute}
          disabled={!canExecute}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-green-600 hover:bg-green-700 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-md transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          Run
        </button>

        {/* Close */}
        <button
          onClick={onToggle}
          className="flex-shrink-0 p-1.5 text-gray-400 hover:text-gray-200 hover:bg-gray-700 rounded transition-colors"
          aria-label="Close search bar"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Preview */}
      {selectedPreset && (selectedFile || selectedPreset.id === 'cd-dir') && (
        <div className="mt-2">
          <code className="text-xs text-green-400 bg-gray-900/80 px-2 py-1 rounded block truncate font-mono">
            $ {selectedPreset.id === 'cd-dir' ? `cd ${currentDir}` : selectedPreset.buildCommand(keyword, selectedFile)}
          </code>
        </div>
      )}
    </div>
  );
}
