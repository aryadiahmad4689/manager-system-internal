'use client';

import { useState } from 'react';

interface AIAnalyzeModalProps {
  isOpen: boolean;
  onClose: () => void;
  logText: string;
}

export default function AIAnalyzeModal({ isOpen, onClose, logText }: AIAnalyzeModalProps) {
  const [prompt, setPrompt] = useState('');
  const [analysis, setAnalysis] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [tokensUsed, setTokensUsed] = useState(0);

  async function handleAnalyze() {
    setError('');
    setAnalysis('');
    setLoading(true);

    try {
      const res = await fetch('/api/ai/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ logText, prompt: prompt.trim() || undefined }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Failed to analyze');
        return;
      }

      setAnalysis(data.analysis);
      setTokensUsed(data.tokensUsed || 0);
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/60" onClick={onClose} aria-hidden="true" />
      <div className="relative w-full max-w-2xl max-h-[85vh] bg-gray-800 border border-gray-700 rounded-lg shadow-xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700">
          <h2 className="text-lg font-semibold text-gray-100 flex items-center gap-2">
            <span className="text-xl">🤖</span> AI Log Analysis
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-200" aria-label="Close">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Selected log preview */}
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-1">
              Log yang dipilih ({logText.length} chars)
            </label>
            <pre className="max-h-[120px] overflow-y-auto text-xs text-gray-300 bg-gray-900 rounded-md p-3 font-mono whitespace-pre-wrap break-all border border-gray-700">
              {logText.slice(0, 2000)}{logText.length > 2000 ? '\n... (truncated)' : ''}
            </pre>
          </div>

          {/* Prompt input */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              Prompt (opsional)
            </label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Contoh: Kenapa error ini terjadi? / Apa solusinya? / Jelaskan alur request ini"
              rows={2}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
            <div className="flex flex-wrap gap-1.5 mt-2">
              {['Apa penyebab error ini?', 'Berikan solusi', 'Jelaskan log ini', 'Apakah ada security issue?'].map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => setPrompt(q)}
                  className="px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 rounded border border-gray-600 transition-colors"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>

          {/* Analyze button */}
          <button
            onClick={handleAnalyze}
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-purple-600 hover:bg-purple-700 disabled:bg-gray-700 disabled:text-gray-500 rounded-md transition-colors"
          >
            {loading ? (
              <>
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Analyzing...
              </>
            ) : (
              <>
                <span>✨</span> Analyze with AI
              </>
            )}
          </button>

          {/* Error */}
          {error && (
            <div className="text-sm text-red-400 bg-red-900/30 border border-red-800 rounded-md px-4 py-3">
              {error}
            </div>
          )}

          {/* Result */}
          {analysis && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium text-gray-300">Hasil Analisis</h3>
                {tokensUsed > 0 && (
                  <span className="text-xs text-gray-500">{tokensUsed} tokens</span>
                )}
              </div>
              <div className="prose prose-invert prose-sm max-w-none bg-gray-900 rounded-md p-4 border border-gray-700 overflow-y-auto max-h-[300px]">
                <div className="text-sm text-gray-200 whitespace-pre-wrap">{analysis}</div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
