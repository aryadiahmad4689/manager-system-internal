'use client';

import { useMemo, useState } from 'react';

/**
 * Recursively expand string values that contain valid JSON.
 * e.g. trace: "[{\"host\":...}]" → trace: [{host:...}]
 */
function expandJsonStrings(obj: any): any {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'string') {
    const trimmed = obj.trim();
    if ((trimmed.startsWith('{') || trimmed.startsWith('[')) && trimmed.length > 2) {
      try {
        const parsed = JSON.parse(trimmed);
        return expandJsonStrings(parsed);
      } catch {
        return obj;
      }
    }
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(expandJsonStrings);
  }
  if (typeof obj === 'object') {
    const result: any = {};
    for (const key of Object.keys(obj)) {
      result[key] = expandJsonStrings(obj[key]);
    }
    return result;
  }
  return obj;
}

interface PrettifyModalProps {
  isOpen: boolean;
  onClose: () => void;
  rawText: string;
}

export default function PrettifyModal({ isOpen, onClose, rawText }: PrettifyModalProps) {
  const [viewMode, setViewMode] = useState<'pretty' | 'raw'>('pretty');

  // Strip ANSI codes and try to parse/format JSON
  const formatted = useMemo(() => {
    // eslint-disable-next-line no-control-regex
    const clean = rawText.replace(/\x1b\[[0-9;]*m/g, '').trim();

    // Try to find and format JSON objects in the text
    const results: { type: 'json' | 'text'; content: any }[] = [];
    const lines = clean.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // Try to parse as JSON
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try {
          const parsed = JSON.parse(trimmed);
          // Recursively expand JSON strings inside values
          const expanded = expandJsonStrings(parsed);
          results.push({ type: 'json', content: expanded });
          continue;
        } catch {
          // Not valid JSON
        }
      }

      // Try to find JSON embedded in the line
      const jsonStart = trimmed.indexOf('{');
      if (jsonStart > 0) {
        const candidate = trimmed.slice(jsonStart);
        try {
          const parsed = JSON.parse(candidate);
          const expanded = expandJsonStrings(parsed);
          const prefix = trimmed.slice(0, jsonStart);
          results.push({ type: 'text', content: prefix });
          results.push({ type: 'json', content: expanded });
          continue;
        } catch {
          // Not valid JSON
        }
      }

      results.push({ type: 'text', content: trimmed });
    }

    return results;
  }, [rawText]);

  const copyToClipboard = () => {
    const text = formatted.map((r) => 
      r.type === 'json' ? JSON.stringify(r.content, null, 2) : r.content
    ).join('\n');
    navigator.clipboard.writeText(text);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/60" onClick={onClose} aria-hidden="true" />
      <div className="relative w-full max-w-3xl max-h-[85vh] bg-gray-800 border border-gray-700 rounded-lg shadow-xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-700">
          <h2 className="text-lg font-semibold text-gray-100 flex items-center gap-2">
            <span>✨</span> Prettify Log
          </h2>
          <div className="flex items-center gap-2">
            {/* View toggle */}
            <div className="flex rounded-md overflow-hidden border border-gray-600">
              <button
                onClick={() => setViewMode('pretty')}
                className={`px-3 py-1 text-xs font-medium transition-colors ${
                  viewMode === 'pretty' ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-400 hover:text-gray-200'
                }`}
              >
                Pretty
              </button>
              <button
                onClick={() => setViewMode('raw')}
                className={`px-3 py-1 text-xs font-medium transition-colors ${
                  viewMode === 'raw' ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-400 hover:text-gray-200'
                }`}
              >
                Raw
              </button>
            </div>
            {/* Copy */}
            <button
              onClick={copyToClipboard}
              className="px-3 py-1 text-xs font-medium text-gray-300 bg-gray-700 hover:bg-gray-600 rounded-md transition-colors"
            >
              📋 Copy
            </button>
            {/* Close */}
            <button onClick={onClose} className="text-gray-400 hover:text-gray-200" aria-label="Close">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-4">
          {viewMode === 'raw' ? (
            <pre className="text-xs text-gray-300 font-mono whitespace-pre-wrap break-all">
              {rawText}
            </pre>
          ) : (
            <div className="space-y-2">
              {formatted.map((block, i) => (
                <div key={i}>
                  {block.type === 'json' ? (
                    <pre className="text-xs font-mono bg-gray-900 rounded-md p-3 border border-gray-700 overflow-x-auto whitespace-pre-wrap">
                      <JsonHighlight json={JSON.stringify(block.content, null, 2)} />
                    </pre>
                  ) : (
                    <p className="text-xs text-gray-400 font-mono">{block.content}</p>
                  )}
                </div>
              ))}
              {formatted.length === 0 && (
                <p className="text-sm text-gray-500">No content to display</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Renders JSON with syntax highlighting using CSS classes.
 */
function JsonHighlight({ json }: { json: string }) {
  const highlighted = json
    .replace(/"([^"]+)"(?=\s*:)/g, '<span class="text-cyan-400">"$1"</span>') // keys
    .replace(/:\s*"([^"]*)"(,?)/g, ': <span class="text-green-400">"$1"</span>$2') // string values
    .replace(/:\s*(\d+\.?\d*)(,?)/g, ': <span class="text-yellow-400">$1</span>$2') // numbers
    .replace(/:\s*(true|false)(,?)/g, ': <span class="text-purple-400">$1</span>$2') // booleans
    .replace(/:\s*(null)(,?)/g, ': <span class="text-gray-500">$1</span>$2'); // null

  return <code dangerouslySetInnerHTML={{ __html: highlighted }} className="text-gray-300" />;
}
