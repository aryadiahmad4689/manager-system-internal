'use client';

import { useEffect, useState } from 'react';
import type {
  SecurityAuthType,
  SecurityConnectionPublic,
  SecurityProvider,
  SecurityTestResult,
} from '@/lib/security/types';

interface SecurityConnectionModalProps {
  isOpen: boolean;
  editingConnection: SecurityConnectionPublic | null;
  onClose: () => void;
  onSaved: (conn: SecurityConnectionPublic) => void;
}

const PROVIDER_META: Record<
  SecurityProvider,
  {
    name: string;
    urlPlaceholder: string;
    labelPlaceholder: string;
    tokenLabel: string;
  }
> = {
  sonarqube: {
    name: 'SonarQube Enterprise',
    urlPlaceholder: 'https://sonarqube-enterprise.bri.co.id/',
    labelPlaceholder: 'SonarQube BRI Enterprise',
    tokenLabel: 'SonarQube User Token (squ_...)',
  },
  cxsast: {
    name: 'Checkmarx SAST',
    urlPlaceholder: 'https://sast.bri.co.id/',
    labelPlaceholder: 'Checkmarx SAST BRI',
    tokenLabel: 'Bearer Access Token',
  },
  cxsca: {
    name: 'Checkmarx SCA',
    urlPlaceholder: 'https://eu.sca.checkmarx.net/',
    labelPlaceholder: 'Checkmarx SCA (BRI)',
    tokenLabel: 'Bearer Access Token',
  },
};

export default function SecurityConnectionModal({
  isOpen,
  editingConnection,
  onClose,
  onSaved,
}: SecurityConnectionModalProps) {
  const [provider, setProvider] = useState<SecurityProvider>('sonarqube');
  const [label, setLabel] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [authType, setAuthType] = useState<SecurityAuthType>('password');
  const [tenantAccount, setTenantAccount] = useState('');
  const [username, setUsername] = useState('');
  const [secret, setSecret] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [insecureTls, setInsecureTls] = useState(true);

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<SecurityTestResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen) return;

    if (editingConnection) {
      setProvider(editingConnection.provider);
      setLabel(editingConnection.label);
      setBaseUrl(editingConnection.baseUrl);
      setAuthType(editingConnection.authType);
      setTenantAccount(editingConnection.tenantAccount || '');
      setUsername(editingConnection.username || '');
      setSecret('');
      setClientId(editingConnection.clientId || '');
      setClientSecret('');
      setInsecureTls(editingConnection.insecureTls);
      setShowAdvanced(
        Boolean(editingConnection.clientId || editingConnection.hasClientSecret)
      );
    } else {
      setProvider('sonarqube');
      setLabel('');
      setBaseUrl('');
      setAuthType('password');
      setTenantAccount('');
      setUsername('');
      setSecret('');
      setClientId('');
      setClientSecret('');
      setInsecureTls(true);
      setShowAdvanced(false);
    }

    setShowSecret(false);
    setTestResult(null);
    setError('');
  }, [isOpen, editingConnection]);

  if (!isOpen) return null;

  const meta = PROVIDER_META[provider];

  async function handleTestConnection() {
    setError('');
    setTestResult(null);

    if (!baseUrl.trim()) {
      setError('Portal / Server URL is required');
      return;
    }
    if (provider === 'cxsca' && authType === 'password' && !tenantAccount.trim()) {
      setError('Account / Tenant name (e.g. bri) is required for Checkmarx SCA');
      return;
    }
    if (authType === 'password' && !username.trim()) {
      setError('Username is required');
      return;
    }
    if (!editingConnection && !secret.trim()) {
      setError(authType === 'token' ? 'Token is required' : 'Password is required');
      return;
    }

    setTesting(true);
    try {
      const res = await fetch('/api/security/connections/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          connectionId: editingConnection?.id,
          provider,
          baseUrl: baseUrl.trim(),
          authType,
          tenantAccount:
            provider === 'cxsca' ? tenantAccount.trim() : undefined,
          username: authType === 'password' ? username.trim() : undefined,
          clientId:
            provider === 'cxsast' && clientId.trim()
              ? clientId.trim()
              : undefined,
          clientSecret:
            provider === 'cxsast' && clientSecret.trim()
              ? clientSecret.trim()
              : undefined,
          secret,
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
      setError('Network error while testing connection');
    } finally {
      setTesting(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (!label.trim()) {
      setError('Connection label is required');
      return;
    }
    if (!baseUrl.trim()) {
      setError('Portal / Server URL is required');
      return;
    }
    if (provider === 'cxsca' && authType === 'password' && !tenantAccount.trim()) {
      setError('Account / Tenant name is required for Checkmarx SCA');
      return;
    }
    if (authType === 'password' && !username.trim()) {
      setError('Username is required');
      return;
    }
    if (!editingConnection && !secret.trim()) {
      setError(authType === 'token' ? 'Token is required' : 'Password is required');
      return;
    }

    setSubmitting(true);
    try {
      const endpoint = editingConnection
        ? `/api/security/connections/${editingConnection.id}`
        : '/api/security/connections';
      const method = editingConnection ? 'PUT' : 'POST';

      const payload: Record<string, unknown> = {
        ...(!editingConnection ? { provider } : {}),
        label: label.trim(),
        baseUrl: baseUrl.trim(),
        authType,
        tenantAccount:
          provider === 'cxsca' ? tenantAccount.trim() || null : null,
        username: authType === 'password' ? username.trim() : null,
        clientId: provider === 'cxsast' ? clientId.trim() || null : null,
        insecureTls,
      };
      if (secret.trim()) {
        payload.secret = secret;
      }
      if (provider === 'cxsast' && clientSecret.trim()) {
        payload.clientSecret = clientSecret.trim();
      }

      const res = await fetch(endpoint, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to save security connection');
        return;
      }

      onSaved(data);
    } catch {
      setError('Network error while saving security connection');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 md:p-4">
      <div
        className="fixed inset-0 bg-black/60"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="relative w-full max-w-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-2xl overflow-hidden z-10">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            {editingConnection
              ? `Edit ${meta.name}`
              : 'Add Security Scanner Connection'}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
            aria-label="Close modal"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form
          onSubmit={handleSubmit}
          className="p-5 space-y-4 max-h-[82vh] overflow-y-auto"
        >
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
                    User: {testResult.username || '-'}
                    {testResult.version ? ` • Version: ${testResult.version}` : ''}
                    {testResult.projectCount !== undefined
                      ? ` • Projects: ${testResult.projectCount}`
                      : ''}
                  </p>
                </div>
              ) : (
                <p>{testResult.error || 'Connection test failed'}</p>
              )}
            </div>
          )}

          {!editingConnection && (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                Scanner Platform *
              </label>
              <div className="grid grid-cols-3 gap-2">
                {(
                  [
                    ['sonarqube', 'SonarQube'],
                    ['cxsast', 'Checkmarx SAST'],
                    ['cxsca', 'Checkmarx SCA'],
                  ] as [SecurityProvider, string][]
                ).map(([key, title]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => {
                      setProvider(key);
                      setTestResult(null);
                      setError('');
                    }}
                    className={`px-2.5 py-2 text-xs font-medium rounded-lg border transition-colors ${
                      provider === key
                        ? 'bg-indigo-50 dark:bg-indigo-900/40 border-indigo-500 text-indigo-700 dark:text-indigo-300'
                        : 'bg-gray-50 dark:bg-gray-900 border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300'
                    }`}
                  >
                    {title}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Label *
            </label>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={meta.labelPlaceholder}
              className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Portal / Base URL *
            </label>
            <input
              type="url"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder={meta.urlPlaceholder}
              className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
            />
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Pasting full login URLs (like /sessions/new or /CxRestAPI/auth/...) is automatically normalized.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
              Authentication Mode
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setAuthType('password')}
                className={`px-3 py-2 text-xs font-medium rounded-lg border transition-colors ${
                  authType === 'password'
                    ? 'bg-indigo-50 dark:bg-indigo-900/40 border-indigo-500 text-indigo-700 dark:text-indigo-300'
                    : 'bg-gray-50 dark:bg-gray-900 border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300'
                }`}
              >
                Username & Password
              </button>
              <button
                type="button"
                onClick={() => setAuthType('token')}
                className={`px-3 py-2 text-xs font-medium rounded-lg border transition-colors ${
                  authType === 'token'
                    ? 'bg-indigo-50 dark:bg-indigo-900/40 border-indigo-500 text-indigo-700 dark:text-indigo-300'
                    : 'bg-gray-50 dark:bg-gray-900 border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300'
                }`}
              >
                API / Bearer Token
              </button>
            </div>
          </div>

          {provider === 'cxsca' && authType === 'password' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Account / Tenant *
              </label>
              <input
                type="text"
                value={tenantAccount}
                onChange={(e) => setTenantAccount(e.target.value)}
                placeholder="bri"
                className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
              />
            </div>
          )}

          {authType === 'password' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Username *
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder={provider === 'sonarqube' ? 'brimo' : 'sap'}
                autoComplete="off"
                className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
              />
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {authType === 'token' ? meta.tokenLabel : 'Password'}
              {editingConnection ? ' (leave blank to keep current)' : ' *'}
            </label>
            <div className="relative">
              <input
                type={showSecret ? 'text' : 'password'}
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                placeholder={editingConnection ? '••••••••' : 'Enter secret'}
                autoComplete="new-password"
                className="w-full px-3 py-2 pr-16 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
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

          {provider === 'cxsast' && authType === 'password' && (
            <div>
              <button
                type="button"
                onClick={() => setShowAdvanced((v) => !v)}
                className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
              >
                {showAdvanced
                  ? 'Hide Advanced OAuth Client Settings'
                  : 'Advanced OAuth Client Settings (optional)'}
              </button>
              {showAdvanced && (
                <div className="mt-2 p-3 rounded-lg bg-gray-50 dark:bg-gray-900/60 border border-gray-200 dark:border-gray-700 space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                      OAuth Client ID (default: resource_owner_client)
                    </label>
                    <input
                      type="text"
                      value={clientId}
                      onChange={(e) => setClientId(e.target.value)}
                      placeholder="resource_owner_client"
                      className="w-full px-2.5 py-1.5 text-xs font-mono rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                      OAuth Client Secret (optional override)
                    </label>
                    <input
                      type="password"
                      value={clientSecret}
                      onChange={(e) => setClientSecret(e.target.value)}
                      placeholder="Leave blank for default CxSAST 9.x secret"
                      className="w-full px-2.5 py-1.5 text-xs font-mono rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
            <input
              type="checkbox"
              checked={insecureTls}
              onChange={(e) => setInsecureTls(e.target.checked)}
              className="rounded border-gray-300 dark:border-gray-600"
            />
            <span>Skip TLS certificate verification (Internal / Self-signed CA)</span>
          </label>

          <div className="flex items-center justify-between pt-3 border-t border-gray-200 dark:border-gray-700">
            <button
              type="button"
              onClick={handleTestConnection}
              disabled={testing || submitting}
              className="px-3.5 py-2 text-sm font-medium text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-900/40 hover:bg-blue-100 dark:hover:bg-blue-900/60 border border-blue-200 dark:border-blue-800 rounded-lg disabled:opacity-50"
            >
              {testing ? 'Testing...' : 'Test Connection'}
            </button>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting || testing}
                className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg disabled:opacity-50"
              >
                {submitting
                  ? 'Saving...'
                  : editingConnection
                  ? 'Update'
                  : 'Save Connection'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
