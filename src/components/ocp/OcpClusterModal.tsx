'use client';

import { useEffect, useState } from 'react';
import { deriveApiUrlFromConsoleUrl } from '@/lib/ocp/ocp-urls';
import type { OcpAuthType, OcpClusterPublic, OcpTestResult } from '@/lib/ocp/types';

interface OcpClusterModalProps {
  isOpen: boolean;
  editingCluster: OcpClusterPublic | null;
  onClose: () => void;
  onSaved: (cluster: OcpClusterPublic) => void;
}

export default function OcpClusterModal({
  isOpen,
  editingCluster,
  onClose,
  onSaved,
}: OcpClusterModalProps) {
  const [label, setLabel] = useState('');
  const [consoleUrl, setConsoleUrl] = useState('');
  const [apiUrl, setApiUrl] = useState('');
  const [apiUrlManuallyEdited, setApiUrlManuallyEdited] = useState(false);
  const [authType, setAuthType] = useState<OcpAuthType>('oauth_password');
  const [username, setUsername] = useState('');
  const [secret, setSecret] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [defaultNamespace, setDefaultNamespace] = useState('');
  const [insecureTls, setInsecureTls] = useState(true);

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<OcpTestResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen) return;

    if (editingCluster) {
      setLabel(editingCluster.label);
      setConsoleUrl(editingCluster.consoleUrl);
      setApiUrl(editingCluster.apiUrl);
      setApiUrlManuallyEdited(true);
      setAuthType(editingCluster.authType);
      setUsername(editingCluster.username || '');
      setSecret('');
      setDefaultNamespace(editingCluster.defaultNamespace || '');
      setInsecureTls(editingCluster.insecureTls);
    } else {
      setLabel('');
      setConsoleUrl('');
      setApiUrl('');
      setApiUrlManuallyEdited(false);
      setAuthType('oauth_password');
      setUsername('');
      setSecret('');
      setDefaultNamespace('');
      setInsecureTls(true);
    }

    setShowSecret(false);
    setTestResult(null);
    setError('');
  }, [isOpen, editingCluster]);

  if (!isOpen) return null;

  function handleConsoleUrlChange(value: string) {
    setConsoleUrl(value);
    if (!apiUrlManuallyEdited && value.trim()) {
      try {
        setApiUrl(deriveApiUrlFromConsoleUrl(value));
      } catch {
        // Ignore partial URL while user is still typing
      }
    }
  }

  async function handleTestConnection() {
    setError('');
    setTestResult(null);

    if (!consoleUrl.trim()) {
      setError('Console URL is required');
      return;
    }
    if (authType === 'oauth_password' && !username.trim()) {
      setError('Username is required for OAuth login');
      return;
    }
    if (!editingCluster && !secret.trim()) {
      setError(authType === 'token' ? 'Bearer token is required' : 'Password is required');
      return;
    }

    setTesting(true);
    try {
      const res = await fetch('/api/ocp/clusters/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clusterId: editingCluster?.id,
          consoleUrl: consoleUrl.trim(),
          apiUrl: apiUrl.trim() || undefined,
          authType,
          username: authType === 'oauth_password' ? username.trim() : undefined,
          secret: secret,
          insecureTls,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Connection test failed');
        return;
      }
      setTestResult(data);
    } catch {
      setError('Network error while testing OCP connection');
    } finally {
      setTesting(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (!label.trim()) {
      setError('Cluster label is required');
      return;
    }
    if (!consoleUrl.trim()) {
      setError('Console URL is required');
      return;
    }
    if (authType === 'oauth_password' && !username.trim()) {
      setError('Username is required');
      return;
    }
    if (!editingCluster && !secret.trim()) {
      setError(authType === 'token' ? 'Bearer token is required' : 'Password is required');
      return;
    }

    setSubmitting(true);
    try {
      const endpoint = editingCluster
        ? `/api/ocp/clusters/${editingCluster.id}`
        : '/api/ocp/clusters';
      const method = editingCluster ? 'PUT' : 'POST';

      const payload: Record<string, unknown> = {
        label: label.trim(),
        consoleUrl: consoleUrl.trim(),
        apiUrl: apiUrl.trim() || undefined,
        authType,
        username: authType === 'oauth_password' ? username.trim() : null,
        defaultNamespace: defaultNamespace.trim() || null,
        insecureTls,
      };
      if (secret.trim()) {
        payload.secret = secret;
      }

      const res = await fetch(endpoint, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to save OCP cluster');
        return;
      }

      onSaved(data);
    } catch {
      setError('Network error while saving OCP cluster');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 md:p-4">
      <div className="fixed inset-0 bg-black/60" onClick={onClose} aria-hidden="true" />
      <div className="relative w-full max-w-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-2xl overflow-hidden z-10">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            {editingCluster ? 'Edit OCP Cluster' : 'Add OCP Cluster'}
          </h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
            aria-label="Close modal"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4 max-h-[82vh] overflow-y-auto">
          {error && (
            <div className="p-3 text-sm text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg">
              {error}
            </div>
          )}

          {testResult && (
            <div
              className={`p-3 text-sm rounded-lg border ${
                testResult.connected
                  ? 'text-emerald-800 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-900/30 border-emerald-200 dark:border-emerald-800'
                  : 'text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/30 border-red-200 dark:border-red-800'
              }`}
            >
              {testResult.connected ? (
                <div className="space-y-0.5">
                  <p className="font-semibold">Connected successfully</p>
                  <p className="text-xs opacity-90">
                    User: {testResult.username || '-'} • Version: {testResult.serverVersion || 'OCP API OK'}
                  </p>
                </div>
              ) : (
                <p>{testResult.error || 'Connection test failed'}</p>
              )}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Cluster Label *
            </label>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. OCP New Dev (BRImo)"
              className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-red-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              OpenShift Console URL *
            </label>
            <input
              type="url"
              value={consoleUrl}
              onChange={(e) => handleConsoleUrlChange(e.target.value)}
              placeholder="https://console-openshift-console.apps.ocp-new-dev.bri.co.id/"
              className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-red-500"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                API Server URL
              </label>
              {apiUrlManuallyEdited && consoleUrl.trim() && (
                <button
                  type="button"
                  onClick={() => {
                    try {
                      setApiUrl(deriveApiUrlFromConsoleUrl(consoleUrl));
                      setApiUrlManuallyEdited(false);
                    } catch {
                      // ignore
                    }
                  }}
                  className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                >
                  Auto-derive from Console URL
                </button>
              )}
            </div>
            <input
              type="url"
              value={apiUrl}
              onChange={(e) => {
                setApiUrl(e.target.value);
                setApiUrlManuallyEdited(true);
              }}
              placeholder="https://api.ocp-new-dev.bri.co.id:6443"
              className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-red-500"
            />
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Derived automatically from Console URL; override if your cluster uses a custom API port/host.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
              Authentication Mode
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setAuthType('oauth_password')}
                className={`px-3 py-2 text-xs font-medium rounded-lg border transition-colors ${
                  authType === 'oauth_password'
                    ? 'bg-red-50 dark:bg-red-900/40 border-red-500 text-red-700 dark:text-red-300'
                    : 'bg-gray-50 dark:bg-gray-900 border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300'
                }`}
              >
                Username & Password (OAuth)
              </button>
              <button
                type="button"
                onClick={() => setAuthType('token')}
                className={`px-3 py-2 text-xs font-medium rounded-lg border transition-colors ${
                  authType === 'token'
                    ? 'bg-red-50 dark:bg-red-900/40 border-red-500 text-red-700 dark:text-red-300'
                    : 'bg-gray-50 dark:bg-gray-900 border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300'
                }`}
              >
                Bearer Token (sha256~)
              </button>
            </div>
          </div>

          {authType === 'oauth_password' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Username *
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="brimo"
                autoComplete="off"
                className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-red-500"
              />
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {authType === 'token' ? 'API Bearer Token' : 'Password'}
              {editingCluster ? ' (leave blank to keep current)' : ' *'}
            </label>
            <div className="relative">
              <input
                type={showSecret ? 'text' : 'password'}
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                placeholder={
                  editingCluster
                    ? '••••••••'
                    : authType === 'token'
                    ? 'sha256~...'
                    : 'Enter OCP password'
                }
                autoComplete="new-password"
                className="w-full px-3 py-2 pr-16 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-red-500"
              />
              <button
                type="button"
                onClick={() => setShowSecret((v) => !v)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
              >
                {showSecret ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Default Project / Namespace (Optional)
            </label>
            <input
              type="text"
              value={defaultNamespace}
              onChange={(e) => setDefaultNamespace(e.target.value)}
              placeholder="e.g. brimo-dev"
              className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-red-500"
            />
          </div>

          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
            <input
              type="checkbox"
              checked={insecureTls}
              onChange={(e) => setInsecureTls(e.target.checked)}
              className="rounded border-gray-300 dark:border-gray-600 text-red-600 focus:ring-red-500"
            />
            <span>Skip TLS certificate verification (Self-signed / Internal CA)</span>
          </label>

          <div className="flex items-center justify-between pt-3 border-t border-gray-200 dark:border-gray-700">
            <button
              type="button"
              onClick={handleTestConnection}
              disabled={testing || submitting}
              className="px-3.5 py-2 text-sm font-medium text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-900/40 hover:bg-blue-100 dark:hover:bg-blue-900/60 border border-blue-200 dark:border-blue-800 rounded-lg transition-colors disabled:opacity-50"
            >
              {testing ? 'Testing...' : 'Test Connection'}
            </button>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting || testing}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors disabled:opacity-50"
              >
                {submitting ? 'Saving...' : editingCluster ? 'Update Cluster' : 'Save Cluster'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
