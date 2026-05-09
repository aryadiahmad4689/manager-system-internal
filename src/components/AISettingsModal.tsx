'use client';

import { useState, useEffect } from 'react';

interface AISettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function AISettingsModal({ isOpen, onClose }: AISettingsModalProps) {
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('gpt-4o-mini');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [configured, setConfigured] = useState(false);
  const [apiKeyHint, setApiKeyHint] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (isOpen) {
      setApiKey('');
      setMessage('');
      setError('');
      loadSettings();
    }
  }, [isOpen]);

  async function loadSettings() {
    setLoading(true);
    try {
      const res = await fetch('/api/ai/settings');
      if (res.ok) {
        const data = await res.json();
        setConfigured(data.configured);
        setModel(data.model);
        setApiKeyHint(data.apiKeyHint);
      }
    } catch {
      setError('Failed to load settings');
    } finally {
      setLoading(false);
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setMessage('');

    if (!apiKey.trim()) {
      setError('API Key wajib diisi');
      return;
    }

    setSaving(true);
    try {
      const res = await fetch('/api/ai/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'openai', apiKey: apiKey.trim(), model }),
      });

      if (res.ok) {
        setMessage('Settings saved!');
        setConfigured(true);
        setApiKeyHint('••••' + apiKey.trim().slice(-4));
        setApiKey('');
      } else {
        const data = await res.json();
        setError(data.error || 'Failed to save');
      }
    } catch {
      setError('Network error');
    } finally {
      setSaving(false);
    }
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/60" onClick={onClose} aria-hidden="true" />
      <div className="relative w-full max-w-md bg-gray-800 border border-gray-700 rounded-lg shadow-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold text-gray-100 flex items-center gap-2">
            <span className="text-2xl">🤖</span> AI Settings
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-200" aria-label="Close">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {loading ? (
          <div className="py-8 text-center text-gray-400">Loading...</div>
        ) : (
          <form onSubmit={handleSave} className="space-y-4">
            {/* Status */}
            <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-gray-700/50">
              <div className={`w-2.5 h-2.5 rounded-full ${configured ? 'bg-green-500' : 'bg-red-500'}`} />
              <span className="text-sm text-gray-300">
                {configured ? `Configured (${apiKeyHint})` : 'Not configured'}
              </span>
            </div>

            {/* Provider */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Provider</label>
              <select
                value="openai"
                disabled
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-gray-100 disabled:opacity-60"
              >
                <option value="openai">OpenAI (ChatGPT)</option>
              </select>
              <p className="text-xs text-gray-500 mt-1">More providers coming soon</p>
            </div>

            {/* Model */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Model</label>
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-gray-100"
              >
                <option value="gpt-4o-mini">GPT-4o Mini (Fast & Cheap)</option>
                <option value="gpt-4o">GPT-4o (Best Quality)</option>
                <option value="gpt-4-turbo">GPT-4 Turbo</option>
                <option value="gpt-3.5-turbo">GPT-3.5 Turbo (Cheapest)</option>
              </select>
            </div>

            {/* API Key */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                API Key {configured && <span className="text-gray-500">(kosongkan jika tidak ingin ganti)</span>}
              </label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={configured ? 'Enter new key to replace...' : 'sk-...'}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-xs text-gray-500 mt-1">
                Dapatkan API key di{' '}
                <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">
                  platform.openai.com
                </a>
              </p>
            </div>

            {error && (
              <div className="text-sm text-red-400 bg-red-900/30 border border-red-800 rounded-md px-3 py-2">
                {error}
              </div>
            )}
            {message && (
              <div className="text-sm text-green-400 bg-green-900/30 border border-green-800 rounded-md px-3 py-2">
                {message}
              </div>
            )}

            <button
              type="submit"
              disabled={saving || !apiKey.trim()}
              className="w-full px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:text-gray-500 rounded-md transition-colors"
            >
              {saving ? 'Saving...' : 'Save Settings'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
