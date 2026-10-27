'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';

interface FileEditorModalProps {
  vmId: string;
  vmLabel: string;
  filePath: string;
  onClose: () => void;
  onSaved?: () => void;
}

export default function FileEditorModal({
  vmId,
  vmLabel,
  filePath,
  onClose,
  onSaved,
}: FileEditorModalProps) {
  const [content, setContent] = useState<string>('');
  const [initialContent, setInitialContent] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [createBackup, setCreateBackup] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [showSearch, setShowSearch] = useState<boolean>(false);
  const [cursorPos, setCursorPos] = useState<{ line: number; col: number }>({ line: 1, col: 1 });

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lineNumbersRef = useRef<HTMLDivElement>(null);

  const isDirty = content !== initialContent;
  const filename = filePath.split('/').pop() || filePath;

  // Fetch file content
  const loadFile = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/vms/${vmId}/files/read?path=${encodeURIComponent(filePath)}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}: Gagal membaca file`);
      }
      const data = await res.json();
      setContent(data.content || '');
      setInitialContent(data.content || '');
    } catch (err: any) {
      setError(err.message || 'Gagal memuat file.');
    } finally {
      setLoading(false);
    }
  }, [vmId, filePath]);

  useEffect(() => {
    loadFile();
  }, [loadFile]);

  // Save handler
  const handleSave = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    setSaveMessage(null);
    try {
      const res = await fetch(`/api/vms/${vmId}/files/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: filePath,
          content,
          createBackup,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Gagal menyimpan file.');
      }

      setInitialContent(content);
      const backupInfo = data.backupPath ? ` (Backup: ${data.backupPath.split('/').pop()})` : '';
      setSaveMessage(`✓ File berhasil disimpan!${backupInfo}`);
      onSaved?.();

      setTimeout(() => {
        setSaveMessage(null);
      }, 4000);
    } catch (err: any) {
      setError(err.message || 'Gagal menyimpan perubahan');
    } finally {
      setSaving(false);
    }
  }, [saving, vmId, filePath, content, createBackup, onSaved]);

  // Keyboard shortcut Ctrl+S / Cmd+S
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        setShowSearch((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleSave]);

  // Handle Tab key for indentation inside textarea
  const handleTextareaKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const ta = e.currentTarget;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;

      // Insert 2 spaces
      const updated = content.substring(0, start) + '  ' + content.substring(end);
      setContent(updated);

      setTimeout(() => {
        ta.selectionStart = ta.selectionEnd = start + 2;
      }, 0);
    }
  };

  // Sync scroll between textarea and line numbers
  const handleScroll = (e: React.UIEvent<HTMLTextAreaElement>) => {
    if (lineNumbersRef.current) {
      lineNumbersRef.current.scrollTop = e.currentTarget.scrollTop;
    }
  };

  // Track cursor position
  const handleSelectOrChange = (e: React.SyntheticEvent<HTMLTextAreaElement>) => {
    const ta = e.currentTarget;
    const pos = ta.selectionStart || 0;
    const textBefore = ta.value.substring(0, pos);
    const lines = textBefore.split('\n');
    const line = lines.length;
    const col = lines[lines.length - 1].length + 1;
    setCursorPos({ line, col });
  };

  // Safe close with unsaved changes prompt
  const handleSafeClose = () => {
    if (isDirty) {
      const confirmLeave = window.confirm(
        'Ada perubahan yang belum disimpan. Yakin ingin keluar tanpa menyimpan?'
      );
      if (!confirmLeave) return;
    }
    onClose();
  };

  // Calculate total line count
  const lineCount = useMemo(() => {
    return Math.max(1, content.split('\n').length);
  }, [content]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 md:p-6"
      data-testid="file-editor-modal"
    >
      <div
        className="fixed inset-0 bg-black/75 backdrop-blur-sm"
        onClick={handleSafeClose}
        aria-hidden="true"
      />

      <div className="relative w-full max-w-5xl h-[92vh] bg-gray-900 border border-gray-700 rounded-xl shadow-2xl flex flex-col overflow-hidden z-10 text-gray-100">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-800 bg-gray-950 flex-shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="p-1.5 rounded-lg bg-emerald-900/60 text-emerald-400 text-lg flex-shrink-0">
              ✏️
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="font-mono font-bold text-base text-gray-100 truncate">
                  {filename}
                </h3>
                {isDirty && (
                  <span
                    className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 font-medium"
                    title="Ada perubahan belum tersimpan"
                  >
                    ● Belum disimpan
                  </span>
                )}
                <span className="text-xs px-2 py-0.5 rounded bg-gray-800 text-gray-400 font-medium flex-shrink-0">
                  {vmLabel}
                </span>
              </div>
              <p className="text-xs font-mono text-gray-400 truncate max-w-xl" title={filePath}>
                {filePath}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            {/* Auto backup option */}
            <label className="hidden sm:flex items-center gap-1.5 text-xs text-gray-400 cursor-pointer hover:text-gray-200">
              <input
                type="checkbox"
                checked={createBackup}
                onChange={(e) => setCreateBackup(e.target.checked)}
                className="rounded border-gray-700 text-blue-600 focus:ring-0 bg-gray-800"
              />
              <span>Auto-backup (.bak)</span>
            </label>

            {/* Search toggle */}
            <button
              onClick={() => setShowSearch((prev) => !prev)}
              className={`p-1.5 rounded text-xs transition-colors ${
                showSearch
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-800 hover:bg-gray-700 text-gray-300'
              }`}
              title="Cari kata kunci (Ctrl+F)"
            >
              🔍 Cari
            </button>

            {/* Save button */}
            <button
              onClick={handleSave}
              disabled={saving || !isDirty}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                isDirty
                  ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-900/30'
                  : 'bg-gray-800 text-gray-500 cursor-not-allowed'
              }`}
              title="Simpan perubahan (Ctrl+S)"
            >
              <svg className={`w-3.5 h-3.5 ${saving ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
              </svg>
              <span>{saving ? 'Menyimpan...' : 'Simpan (Ctrl+S)'}</span>
            </button>

            {/* Close button */}
            <button
              onClick={handleSafeClose}
              className="p-1.5 rounded-lg text-gray-400 hover:text-gray-100 hover:bg-gray-800 transition-colors"
              aria-label="Tutup editor"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Search bar inside editor */}
        {showSearch && (
          <div className="px-4 py-2 border-b border-gray-800 bg-gray-950/80 flex items-center gap-2">
            <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="Cari teks dalam file..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-transparent text-xs text-gray-100 placeholder-gray-500 focus:outline-none"
              autoFocus
            />
            {searchQuery && (
              <span className="text-[11px] text-gray-400 whitespace-nowrap">
                {(content.match(new RegExp(searchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')) || []).length} hasil
              </span>
            )}
            <button
              onClick={() => {
                setSearchQuery('');
                setShowSearch(false);
              }}
              className="text-xs text-gray-400 hover:text-gray-200"
            >
              Tutup
            </button>
          </div>
        )}

        {/* Notifications */}
        {saveMessage && (
          <div className="px-4 py-2 text-xs font-medium bg-emerald-950/80 text-emerald-300 border-b border-emerald-800 flex items-center justify-between">
            <span>{saveMessage}</span>
            <button onClick={() => setSaveMessage(null)} className="underline ml-2">
              Tutup
            </button>
          </div>
        )}

        {error && (
          <div className="px-4 py-2 text-xs font-medium bg-red-950/80 text-red-300 border-b border-red-800 flex items-center justify-between">
            <span>{error}</span>
            <button onClick={() => setError(null)} className="underline ml-2">
              Tutup
            </button>
          </div>
        )}

        {/* Editor Body */}
        <div className="flex-1 flex overflow-hidden relative bg-black/90">
          {loading ? (
            <div className="flex-1 flex flex-col items-center justify-center text-gray-500">
              <svg className="w-8 h-8 animate-spin text-emerald-500 mb-3" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              <p className="text-sm font-medium">Membaca file {filename} via SSH...</p>
            </div>
          ) : (
            <>
              {/* Line Numbers Column */}
              <div
                ref={lineNumbersRef}
                className="w-12 py-3 px-2 text-right font-mono text-xs text-gray-600 bg-gray-950/80 select-none border-r border-gray-800 overflow-hidden leading-relaxed"
                aria-hidden="true"
              >
                {Array.from({ length: lineCount }, (_, i) => (
                  <div key={i + 1}>{i + 1}</div>
                ))}
              </div>

              {/* Textarea Code Editor */}
              <textarea
                ref={textareaRef}
                value={content}
                onChange={(e) => {
                  setContent(e.target.value);
                  handleSelectOrChange(e);
                }}
                onSelect={handleSelectOrChange}
                onKeyDown={handleTextareaKeyDown}
                onScroll={handleScroll}
                spellCheck={false}
                className="flex-1 p-3 font-mono text-xs sm:text-sm text-gray-200 bg-transparent resize-none focus:outline-none leading-relaxed overflow-y-auto select-text whitespace-pre"
                style={{
                  tabSize: 2,
                }}
              />
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-2.5 border-t border-gray-800 bg-gray-950 flex items-center justify-between text-xs text-gray-500 font-mono flex-shrink-0">
          <div className="flex items-center gap-4">
            <span>
              Ln {cursorPos.line}, Col {cursorPos.col}
            </span>
            <span>Total: {lineCount} baris</span>
            <span>Ukuran: {Math.round(content.length / 1024 * 10) / 10} KB</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleSafeClose}
              className="px-3 py-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-300 transition-colors font-sans"
            >
              Batal
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !isDirty}
              className={`px-3 py-1 font-semibold rounded font-sans transition-colors ${
                isDirty
                  ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                  : 'bg-gray-800 text-gray-500 cursor-not-allowed'
              }`}
            >
              {saving ? 'Menyimpan...' : 'Simpan Perubahan'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
