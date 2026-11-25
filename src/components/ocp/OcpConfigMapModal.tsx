'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { validateConfigMapKey } from '@/lib/ocp/ocp-urls';
import type { OcpConfigMap } from '@/lib/ocp/types';

interface OcpConfigMapModalProps {
  clusterId: string;
  clusterLabel: string;
  namespace: string;
  configMapName: string;
  onClose: () => void;
  onSaved: (updated: OcpConfigMap) => void;
}

export default function OcpConfigMapModal({
  clusterId,
  clusterLabel,
  namespace,
  configMapName,
  onClose,
  onSaved,
}: OcpConfigMapModalProps) {
  const [configMap, setConfigMap] = useState<OcpConfigMap | null>(null);
  const [draftData, setDraftData] = useState<Record<string, string>>({});
  const [selectedKey, setSelectedKey] = useState<string>('');
  const [keyFilter, setKeyFilter] = useState<string>('');
  const [newKeyInput, setNewKeyInput] = useState<string>('');
  const [showAddKey, setShowAddKey] = useState<boolean>(false);

  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [successMsg, setSuccessMsg] = useState<string>('');
  const [copiedKey, setCopiedKey] = useState<boolean>(false);

  const loadConfigMap = useCallback(async () => {
    setLoading(true);
    setError('');
    setSuccessMsg('');
    try {
      const res = await fetch(
        `/api/ocp/clusters/${clusterId}/configmaps/${encodeURIComponent(configMapName)}?namespace=${encodeURIComponent(namespace)}`
      );
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || 'Failed to load ConfigMap');
      }
      const cm = json as OcpConfigMap;
      setConfigMap(cm);
      setDraftData({ ...cm.data });
      const keys = Object.keys(cm.data);
      setSelectedKey((prev) => (prev && keys.includes(prev) ? prev : keys[0] || ''));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load ConfigMap');
    } finally {
      setLoading(false);
    }
  }, [clusterId, namespace, configMapName]);

  useEffect(() => {
    loadConfigMap();
  }, [loadConfigMap]);

  const isDirty = useMemo(() => {
    if (!configMap) return false;
    const origKeys = Object.keys(configMap.data);
    const draftKeys = Object.keys(draftData);
    if (origKeys.length !== draftKeys.length) return true;
    return draftKeys.some((k) => configMap.data[k] !== draftData[k]);
  }, [configMap, draftData]);

  const filteredKeys = useMemo(() => {
    const keys = Object.keys(draftData).sort((a, b) => a.localeCompare(b));
    if (!keyFilter.trim()) return keys;
    const q = keyFilter.toLowerCase();
    return keys.filter(
      (k) =>
        k.toLowerCase().includes(q) ||
        (draftData[k] || '').toLowerCase().includes(q)
    );
  }, [draftData, keyFilter]);

  function handleAddKey(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    const trimmed = newKeyInput.trim();
    if (!validateConfigMapKey(trimmed)) {
      setError(
        'Invalid key: only alphanumeric characters, ".", "-", and "_" are allowed'
      );
      return;
    }
    if (Object.prototype.hasOwnProperty.call(draftData, trimmed)) {
      setError(`Key "${trimmed}" already exists`);
      return;
    }
    setDraftData((prev) => ({ ...prev, [trimmed]: '' }));
    setSelectedKey(trimmed);
    setNewKeyInput('');
    setShowAddKey(false);
  }

  function handleRemoveKey(keyToRemove: string) {
    setDraftData((prev) => {
      const next = { ...prev };
      delete next[keyToRemove];
      const remaining = Object.keys(next).sort((a, b) => a.localeCompare(b));
      if (selectedKey === keyToRemove) {
        setSelectedKey(remaining[0] || '');
      }
      return next;
    });
  }

  function handleCopyValue() {
    if (!selectedKey || !navigator?.clipboard) return;
    navigator.clipboard.writeText(draftData[selectedKey] ?? '');
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 1800);
  }

  async function handleSave() {
    if (!configMap || configMap.immutable) return;
    setSaving(true);
    setError('');
    setSuccessMsg('');
    try {
      const res = await fetch(
        `/api/ocp/clusters/${clusterId}/configmaps/${encodeURIComponent(configMapName)}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            namespace,
            data: draftData,
          }),
        }
      );
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || 'Failed to update ConfigMap');
      }
      const updated = json as OcpConfigMap;
      setConfigMap(updated);
      setDraftData({ ...updated.data });
      setSuccessMsg('ConfigMap updated successfully.');
      onSaved(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update ConfigMap');
    } finally {
      setSaving(false);
    }
  }

  const isImmutable = Boolean(configMap?.immutable);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 md:p-6">
      <div
        className="fixed inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="relative w-full max-w-5xl h-[88vh] bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-2xl flex flex-col overflow-hidden z-10">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3.5 border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-950">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="px-2 py-0.5 text-xs font-semibold rounded bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300">
                ConfigMap
              </span>
              <h3 className="font-mono font-bold text-sm md:text-base text-gray-900 dark:text-gray-100">
                {configMapName}
              </h3>
              <span className="text-xs px-2 py-0.5 rounded bg-gray-200 dark:bg-gray-800 text-gray-700 dark:text-gray-300">
                {clusterLabel} / {namespace}
              </span>
              {isImmutable && (
                <span className="text-xs px-2 py-0.5 rounded bg-amber-100 dark:bg-amber-900/50 text-amber-800 dark:text-amber-300 font-medium">
                  Immutable (Read-Only)
                </span>
              )}
              {isDirty && (
                <span className="text-xs px-2 py-0.5 rounded bg-yellow-100 dark:bg-yellow-900/50 text-yellow-800 dark:text-yellow-300 font-medium">
                  Unsaved Changes
                </span>
              )}
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              View & Edit key-value entries
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={loadConfigMap}
              disabled={loading || saving}
              className="px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50"
            >
              Reload
            </button>
            {!isImmutable && (
              <button
                type="button"
                onClick={handleSave}
                disabled={loading || saving || !isDirty}
                className="px-3.5 py-1.5 text-xs font-medium rounded-lg bg-red-600 hover:bg-red-700 text-white disabled:opacity-40 transition-colors"
              >
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-1 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
              aria-label="Close ConfigMap modal"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Alerts */}
        {error && (
          <div className="mx-5 mt-3 p-3 text-xs text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg">
            {error}
          </div>
        )}
        {successMsg && (
          <div className="mx-5 mt-3 p-3 text-xs text-emerald-800 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-200 dark:border-emerald-800 rounded-lg">
            {successMsg}
          </div>
        )}

        {/* Body */}
        <div className="flex-1 min-h-0 flex flex-col md:flex-row overflow-hidden">
          {loading ? (
            <div className="p-6 text-sm text-gray-500 dark:text-gray-400">
              Loading ConfigMap entries...
            </div>
          ) : (
            <>
              {/* Key Sidebar */}
              <div className="w-full md:w-72 border-b md:border-b-0 md:border-r border-gray-200 dark:border-gray-800 flex flex-col bg-gray-50 dark:bg-gray-900/50 max-h-56 md:max-h-none">
                <div className="p-3 space-y-2 border-b border-gray-200 dark:border-gray-800">
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={keyFilter}
                      onChange={(e) => setKeyFilter(e.target.value)}
                      placeholder="Filter keys or values..."
                      className="flex-1 px-2.5 py-1.5 text-xs rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
                    />
                    {!isImmutable && (
                      <button
                        type="button"
                        onClick={() => setShowAddKey((v) => !v)}
                        className="px-2.5 py-1.5 text-xs font-medium rounded bg-blue-600 hover:bg-blue-700 text-white"
                      >
                        + Key
                      </button>
                    )}
                  </div>

                  {showAddKey && !isImmutable && (
                    <form onSubmit={handleAddKey} className="flex items-center gap-1.5">
                      <input
                        type="text"
                        value={newKeyInput}
                        onChange={(e) => setNewKeyInput(e.target.value)}
                        placeholder="e.g. APP_ENV or config.yml"
                        className="flex-1 px-2 py-1 text-xs font-mono rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
                      />
                      <button
                        type="submit"
                        className="px-2 py-1 text-xs rounded bg-emerald-600 hover:bg-emerald-700 text-white"
                      >
                        Add
                      </button>
                    </form>
                  )}
                </div>

                <div className="flex-1 overflow-y-auto divide-y divide-gray-200 dark:divide-gray-800">
                  {filteredKeys.length === 0 ? (
                    <div className="p-4 text-xs text-gray-500">
                      No matching keys.
                    </div>
                  ) : (
                    filteredKeys.map((key) => {
                      const active = key === selectedKey;
                      const modified = configMap && configMap.data[key] !== draftData[key];
                      return (
                        <button
                          key={key}
                          type="button"
                          onClick={() => setSelectedKey(key)}
                          className={`w-full text-left px-3 py-2.5 text-xs font-mono flex items-center justify-between gap-2 transition-colors ${
                            active
                              ? 'bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 font-semibold'
                              : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
                          }`}
                        >
                          <span className="truncate">{key}</span>
                          {modified && (
                            <span
                              className="inline-block w-2 h-2 rounded-full bg-amber-500 flex-shrink-0"
                              title="Modified"
                            />
                          )}
                        </button>
                      );
                    })
                  )}

                  {configMap && configMap.binaryKeys.length > 0 && (
                    <div className="p-3 bg-gray-100/70 dark:bg-gray-950/60">
                      <p className="text-[11px] font-semibold text-gray-500 uppercase mb-1">
                        Binary Keys (Read-only)
                      </p>
                      <div className="flex flex-wrap gap-1">
                        {configMap.binaryKeys.map((bk) => (
                          <span
                            key={bk}
                            className="px-1.5 py-0.5 text-[11px] font-mono rounded bg-gray-200 dark:bg-gray-800 text-gray-600 dark:text-gray-400"
                          >
                            {bk}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Value Editor */}
              <div className="flex-1 flex flex-col min-w-0 min-h-0 p-4 gap-3">
                {selectedKey && Object.prototype.hasOwnProperty.call(draftData, selectedKey) ? (
                  <>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="font-mono text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
                        {selectedKey}
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={handleCopyValue}
                          className="px-2.5 py-1 text-xs rounded border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800"
                        >
                          {copiedKey ? 'Copied!' : 'Copy Value'}
                        </button>
                        {!isImmutable && (
                          <button
                            type="button"
                            onClick={() => handleRemoveKey(selectedKey)}
                            className="px-2.5 py-1 text-xs rounded bg-red-50 dark:bg-red-900/40 text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-900/60"
                          >
                            Remove Key
                          </button>
                        )}
                      </div>
                    </div>

                    <textarea
                      value={draftData[selectedKey] ?? ''}
                      onChange={(e) =>
                        setDraftData((prev) => ({
                          ...prev,
                          [selectedKey]: e.target.value,
                        }))
                      }
                      readOnly={isImmutable}
                      spellCheck={false}
                      className="flex-1 w-full p-3 text-xs font-mono leading-relaxed rounded-lg border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-red-500 resize-none"
                      aria-label={`Value for ${selectedKey}`}
                    />
                  </>
                ) : (
                  <div className="flex-1 flex items-center justify-center text-sm text-gray-500">
                    {Object.keys(draftData).length === 0
                      ? 'This ConfigMap has no string data entries.'
                      : 'Select a key from the left panel to view or edit its value.'}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Footer note */}
        <div className="px-5 py-2.5 border-t border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-950 text-[11px] text-gray-500 dark:text-gray-400">
          Catatan: Perubahan pada ConfigMap tidak otomatis me-restart Pod yang sedang berjalan. Lakukan Restart pada Deployment jika aplikasi tidak mendukung hot-reload.
        </div>
      </div>
    </div>
  );
}
