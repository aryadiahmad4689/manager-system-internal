'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import SecurityConnectionModal from '@/components/security/SecurityConnectionModal';
import AIAnalyzeModal from '@/components/AIAnalyzeModal';
import type {
  SecurityConnectionPublic,
  SecurityFinding,
  SecurityMetricBadge,
  SecurityProjectDetails,
  SecurityProjectSummary,
  SecurityProvider,
  SecurityTestResult,
} from '@/lib/security/types';

const PROVIDER_LABELS: Record<SecurityProvider, string> = {
  sonarqube: 'SonarQube',
  cxsast: 'Checkmarx SAST',
  cxsca: 'Checkmarx SCA',
};

function getProviderBadgeClass(provider: SecurityProvider): string {
  switch (provider) {
    case 'sonarqube':
      return 'bg-sky-100 dark:bg-sky-900/50 text-sky-700 dark:text-sky-300';
    case 'cxsast':
      return 'bg-purple-100 dark:bg-purple-900/50 text-purple-700 dark:text-purple-300';
    case 'cxsca':
      return 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300';
  }
}

function getToneClass(
  tone?: SecurityMetricBadge['tone'] | SecurityProjectSummary['statusTone']
): string {
  switch (tone) {
    case 'success':
      return 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-800 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800';
    case 'warning':
      return 'bg-amber-100 dark:bg-amber-900/50 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-800';
    case 'danger':
      return 'bg-red-100 dark:bg-red-900/50 text-red-800 dark:text-red-300 border-red-200 dark:border-red-800';
    case 'info':
      return 'bg-blue-100 dark:bg-blue-900/50 text-blue-800 dark:text-blue-300 border-blue-200 dark:border-blue-800';
    default:
      return 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-700';
  }
}

function getSeverityBadgeClass(sev: SecurityFinding['severity']): string {
  switch (sev) {
    case 'CRITICAL':
      return 'bg-rose-100 dark:bg-rose-900/60 text-rose-800 dark:text-rose-200';
    case 'HIGH':
      return 'bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-300';
    case 'MEDIUM':
      return 'bg-amber-100 dark:bg-amber-900/50 text-amber-800 dark:text-amber-300';
    case 'LOW':
      return 'bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300';
    default:
      return 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300';
  }
}

export default function SecurityScansPage() {
  const [connections, setConnections] = useState<SecurityConnectionPublic[]>([]);
  const [providerFilter, setProviderFilter] = useState<'all' | SecurityProvider>('all');
  const [selectedConnId, setSelectedConnId] = useState<string>('');
  const [loadingConns, setLoadingConns] = useState<boolean>(true);
  const [testResults, setTestResults] = useState<Record<string, SecurityTestResult>>({});
  const [testingConnId, setTestingConnId] = useState<string | null>(null);

  const [projects, setProjects] = useState<SecurityProjectSummary[]>([]);
  const [projectSearch, setProjectSearch] = useState<string>('');
  const [projectPage, setProjectPage] = useState<number>(1);
  const [loadingProjects, setLoadingProjects] = useState<boolean>(false);
  const [selectedProject, setSelectedProject] =
    useState<SecurityProjectSummary | null>(null);

  const [details, setDetails] = useState<SecurityProjectDetails | null>(null);
  const [loadingDetails, setLoadingDetails] = useState<boolean>(false);
  const [severityFilter, setSeverityFilter] = useState<
    'ALL' | SecurityFinding['severity']
  >('ALL');
  const [findingQuery, setFindingQuery] = useState<string>('');

  const [errorBanner, setErrorBanner] = useState<string>('');
  const [modalOpen, setModalOpen] = useState<boolean>(false);
  const [editingConn, setEditingConn] =
    useState<SecurityConnectionPublic | null>(null);
  const [deleteTarget, setDeleteTarget] =
    useState<SecurityConnectionPublic | null>(null);
  const [aiFindingText, setAiFindingText] = useState<string | null>(null);

  const visibleConnections = useMemo(
    () =>
      providerFilter === 'all'
        ? connections
        : connections.filter((c) => c.provider === providerFilter),
    [connections, providerFilter]
  );

  const activeConnection = useMemo(
    () => connections.find((c) => c.id === selectedConnId) || null,
    [connections, selectedConnId]
  );

  const loadConnections = useCallback(async (preferredId?: string) => {
    setLoadingConns(true);
    setErrorBanner('');
    try {
      const res = await fetch('/api/security/connections');
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to load security connections');
      }
      const list = data as SecurityConnectionPublic[];
      setConnections(list);
      setSelectedConnId((prev) => {
        if (preferredId && list.some((c) => c.id === preferredId)) return preferredId;
        if (prev && list.some((c) => c.id === prev)) return prev;
        return list[0]?.id || '';
      });
    } catch (err) {
      setErrorBanner(
        err instanceof Error ? err.message : 'Failed to load connections'
      );
    } finally {
      setLoadingConns(false);
    }
  }, []);

  useEffect(() => {
    loadConnections();
  }, [loadConnections]);

  useEffect(() => {
    if (
      visibleConnections.length > 0 &&
      !visibleConnections.some((c) => c.id === selectedConnId)
    ) {
      setSelectedConnId(visibleConnections[0].id);
    }
  }, [visibleConnections, selectedConnId]);

  const loadProjects = useCallback(
    async (connectionId: string, q = '') => {
      if (!connectionId) return;
      setLoadingProjects(true);
      setErrorBanner('');
      setSelectedProject(null);
      setDetails(null);
      try {
        const params = q.trim() ? `?q=${encodeURIComponent(q.trim())}` : '';
        const res = await fetch(
          `/api/security/connections/${connectionId}/projects${params}`
        );
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || 'Failed to load projects');
        }
        const list = (data.projects || []) as SecurityProjectSummary[];
        setProjects(list);
        if (list.length > 0) {
          setSelectedProject(list[0]);
        }
      } catch (err) {
        setProjects([]);
        setErrorBanner(
          err instanceof Error ? err.message : 'Failed to load projects'
        );
      } finally {
        setLoadingProjects(false);
      }
    },
    []
  );

  useEffect(() => {
    if (selectedConnId) {
      loadProjects(selectedConnId);
    } else {
      setProjects([]);
      setSelectedProject(null);
      setDetails(null);
    }
  }, [selectedConnId, loadProjects]);

  const loadProjectDetails = useCallback(
    async (connectionId: string, project: SecurityProjectSummary) => {
      setLoadingDetails(true);
      setErrorBanner('');
      try {
        const params = new URLSearchParams({
          projectId: project.id,
          projectName: project.name,
        });
        const res = await fetch(
          `/api/security/connections/${connectionId}/details?${params.toString()}`
        );
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || 'Failed to load project scan details');
        }
        setDetails(data as SecurityProjectDetails);
      } catch (err) {
        setDetails(null);
        setErrorBanner(
          err instanceof Error ? err.message : 'Failed to load project details'
        );
      } finally {
        setLoadingDetails(false);
      }
    },
    []
  );

  useEffect(() => {
    if (selectedConnId && selectedProject) {
      loadProjectDetails(selectedConnId, selectedProject);
    }
  }, [selectedConnId, selectedProject, loadProjectDetails]);

  async function handleTestSaved(connId: string) {
    setTestingConnId(connId);
    setErrorBanner('');
    try {
      const res = await fetch(`/api/security/connections/${connId}/test`, {
        method: 'POST',
      });
      const data: SecurityTestResult = await res.json();
      setTestResults((prev) => ({ ...prev, [connId]: data }));
      if (!data.connected && data.error) {
        setErrorBanner(data.error);
      }
    } catch {
      setErrorBanner('Failed to test connection');
    } finally {
      setTestingConnId(null);
    }
  }

  async function handleDeleteConfirmed() {
    if (!deleteTarget) return;
    try {
      const res = await fetch(`/api/security/connections/${deleteTarget.id}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to delete connection');
      }
      setDeleteTarget(null);
      await loadConnections();
    } catch (err) {
      setErrorBanner(
        err instanceof Error ? err.message : 'Failed to delete connection'
      );
    }
  }

  const filteredProjects = useMemo(() => {
    if (!projectSearch.trim()) return projects;
    const q = projectSearch.trim().toLowerCase();
    return projects.filter(
      (p) =>
        p.name.toLowerCase().includes(q) || p.key.toLowerCase().includes(q)
    );
  }, [projects, projectSearch]);

  const projectsPageSize = 50;
  const totalProjectPages = Math.max(
    1,
    Math.ceil(filteredProjects.length / projectsPageSize)
  );
  const safeProjectPage = Math.min(projectPage, totalProjectPages);
  const pagedProjects = useMemo(() => {
    const start = (safeProjectPage - 1) * projectsPageSize;
    return filteredProjects.slice(start, start + projectsPageSize);
  }, [filteredProjects, safeProjectPage]);

  useEffect(() => {
    setProjectPage(1);
  }, [projectSearch, selectedConnId]);

  const filteredFindings = useMemo(() => {
    const list = details?.findings || [];
    const q = findingQuery.trim().toLowerCase();
    return list.filter((f) => {
      if (severityFilter !== 'ALL' && f.severity !== severityFilter) {
        return false;
      }
      if (!q) return true;
      return (
        f.title.toLowerCase().includes(q) ||
        f.category.toLowerCase().includes(q) ||
        f.location.toLowerCase().includes(q)
      );
    });
  }, [details?.findings, severityFilter, findingQuery]);

  const activeTest = activeConnection
    ? testResults[activeConnection.id]
    : undefined;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            Security Scans
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Monitor SonarQube Quality Gates, Checkmarx SAST results, and Checkmarx SCA CVEs.
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            setEditingConn(null);
            setModalOpen(true);
          }}
          className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-sm"
        >
          + Add Scanner
        </button>
      </div>

      {errorBanner && (
        <div className="flex items-center justify-between p-3 text-sm text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg">
          <span>{errorBanner}</span>
          <button
            type="button"
            onClick={() => setErrorBanner('')}
            className="text-xs underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {loadingConns ? (
        <div className="p-6 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-sm text-gray-500">
          Loading security connections...
        </div>
      ) : connections.length === 0 ? (
        <div className="p-8 bg-white dark:bg-gray-800 border border-dashed border-gray-300 dark:border-gray-700 rounded-xl text-center space-y-3">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            No Security Scanners Configured
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 max-w-lg mx-auto">
            Connect SonarQube Enterprise, Checkmarx SAST, or Checkmarx SCA to inspect project vulnerabilities, quality gates, and dependency risks.
          </p>
          <button
            type="button"
            onClick={() => {
              setEditingConn(null);
              setModalOpen(true);
            }}
            className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg"
          >
            + Add Your First Scanner
          </button>
        </div>
      ) : (
        <>
          {/* Connection Toolbar */}
          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-1.5 flex-wrap">
                {(
                  [
                    ['all', 'All'],
                    ['sonarqube', 'SonarQube'],
                    ['cxsast', 'Checkmarx SAST'],
                    ['cxsca', 'Checkmarx SCA'],
                  ] as ['all' | SecurityProvider, string][]
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setProviderFilter(key)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                      providerFilter === key
                        ? 'bg-indigo-600 text-white'
                        : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {activeConnection && (
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleTestSaved(activeConnection.id)}
                    disabled={testingConnId === activeConnection.id}
                    className="px-3 py-1.5 text-xs font-medium rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 hover:bg-blue-100"
                  >
                    {testingConnId === activeConnection.id
                      ? 'Testing...'
                      : 'Test Connection'}
                  </button>
                  <a
                    href={activeConnection.baseUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
                  >
                    Open Portal ↗
                  </a>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingConn(activeConnection);
                      setModalOpen(true);
                    }}
                    className="px-3 py-1.5 text-xs font-medium rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleteTarget(activeConnection)}
                    className="px-3 py-1.5 text-xs font-medium rounded-lg bg-red-50 dark:bg-red-900/40 text-red-700 dark:text-red-300 hover:bg-red-100"
                  >
                    Delete
                  </button>
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-gray-100 dark:border-gray-700">
              <div className="flex items-center gap-3 flex-wrap flex-1">
                <select
                  value={selectedConnId}
                  onChange={(e) => setSelectedConnId(e.target.value)}
                  className="px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 min-w-[260px]"
                  aria-label="Select security scanner"
                >
                  {visibleConnections.map((c) => (
                    <option key={c.id} value={c.id}>
                      [{PROVIDER_LABELS[c.provider]}] {c.label}
                    </option>
                  ))}
                </select>

                {activeConnection && (
                  <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 flex-wrap">
                    <span
                      className={`px-2 py-0.5 rounded font-medium ${getProviderBadgeClass(
                        activeConnection.provider
                      )}`}
                    >
                      {PROVIDER_LABELS[activeConnection.provider]}
                    </span>
                    <code className="font-mono">{activeConnection.baseUrl}</code>
                    {activeTest && (
                      <span
                        className={`px-2 py-0.5 rounded font-medium ${
                          activeTest.connected
                            ? 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300'
                            : 'bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-300'
                        }`}
                      >
                        {activeTest.connected ? 'Connected' : 'Error'}
                      </span>
                    )}
                  </div>
                )}
              </div>

              {activeConnection && (
                <button
                  type="button"
                  onClick={() =>
                    loadProjects(activeConnection.id, projectSearch)
                  }
                  disabled={loadingProjects}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 disabled:opacity-50"
                >
                  {loadingProjects ? 'Loading...' : 'Refresh Projects'}
                </button>
              )}
            </div>
          </div>

          {/* Main Split View: Projects List + Details */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            {/* Left: Projects */}
            <div className="lg:col-span-4 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl flex flex-col overflow-hidden max-h-[70vh]">
              <div className="p-3 border-b border-gray-200 dark:border-gray-700 space-y-2">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                    Projects ({filteredProjects.length})
                  </h2>
                </div>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (activeConnection) {
                      loadProjects(activeConnection.id, projectSearch);
                    }
                  }}
                  className="flex gap-1.5"
                >
                  <input
                    type="text"
                    value={projectSearch}
                    onChange={(e) => setProjectSearch(e.target.value)}
                    placeholder="Filter or press Enter to search..."
                    className="flex-1 px-2.5 py-1.5 text-xs rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
                  />
                  <button
                    type="submit"
                    className="px-2.5 py-1.5 text-xs rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200"
                  >
                    Search
                  </button>
                </form>
              </div>

              <div className="flex-1 overflow-y-auto divide-y divide-gray-100 dark:divide-gray-700/70">
                {loadingProjects ? (
                  <div className="p-4 text-xs text-gray-500">
                    Loading projects...
                  </div>
                ) : pagedProjects.length === 0 ? (
                  <div className="p-4 text-xs text-gray-500">
                    No projects found.
                  </div>
                ) : (
                  pagedProjects.map((proj) => {
                    const active = selectedProject?.id === proj.id;
                    return (
                      <button
                        key={proj.id}
                        type="button"
                        onClick={() => setSelectedProject(proj)}
                        className={`w-full text-left px-3.5 py-3 transition-colors ${
                          active
                            ? 'bg-indigo-50 dark:bg-indigo-900/30 border-l-4 border-l-indigo-600'
                            : 'hover:bg-gray-50 dark:hover:bg-gray-700/40'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <span className="text-xs font-semibold text-gray-900 dark:text-gray-100 break-all">
                            {proj.name}
                          </span>
                          {proj.statusLabel && (
                            <span
                              className={`px-1.5 py-0.5 text-[10px] rounded border flex-shrink-0 ${getToneClass(
                                proj.statusTone
                              )}`}
                            >
                              {proj.statusLabel}
                            </span>
                          )}
                        </div>
                        <p className="mt-1 text-[11px] font-mono text-gray-500 dark:text-gray-400 truncate">
                          {proj.key}
                        </p>
                      </button>
                    );
                  })
                )}
              </div>

              {filteredProjects.length > projectsPageSize && (
                <div className="px-3 py-2 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 flex items-center justify-between text-xs text-gray-600 dark:text-gray-300">
                  <span>
                    Page {safeProjectPage} / {totalProjectPages}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      disabled={safeProjectPage <= 1}
                      onClick={() => setProjectPage((p) => Math.max(1, p - 1))}
                      className="px-2 py-1 rounded border border-gray-300 dark:border-gray-600 disabled:opacity-40"
                    >
                      Prev
                    </button>
                    <button
                      type="button"
                      disabled={safeProjectPage >= totalProjectPages}
                      onClick={() =>
                        setProjectPage((p) => Math.min(totalProjectPages, p + 1))
                      }
                      className="px-2 py-1 rounded border border-gray-300 dark:border-gray-600 disabled:opacity-40"
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Right: Project Details */}
            <div className="lg:col-span-8 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4 space-y-4 overflow-hidden">
              {!selectedProject ? (
                <div className="py-12 text-center text-sm text-gray-500 dark:text-gray-400">
                  Select a project from the left list to view scan metrics and findings.
                </div>
              ) : loadingDetails ? (
                <div className="py-12 text-center text-sm text-gray-500 dark:text-gray-400">
                  Loading scan results for {selectedProject.name}...
                </div>
              ) : !details ? (
                <div className="py-12 text-center text-sm text-gray-500 dark:text-gray-400">
                  Unable to load scan details for this project.
                </div>
              ) : (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 dark:border-gray-700 pb-3">
                    <div>
                      <h2 className="text-base font-bold text-gray-900 dark:text-gray-100">
                        {details.projectName}
                      </h2>
                      <p className="text-xs font-mono text-gray-500 dark:text-gray-400">
                        Key/ID: {details.projectKey}
                      </p>
                    </div>
                    {details.portalUrl && (
                      <a
                        href={details.portalUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
                      >
                        Open Project in Portal ↗
                      </a>
                    )}
                  </div>

                  {/* Metrics Grid */}
                  {details.metrics.length > 0 && (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                      {details.metrics.map((m) => (
                        <div
                          key={m.label}
                          className={`p-3 rounded-lg border ${getToneClass(m.tone)}`}
                        >
                          <p className="text-[11px] opacity-80">{m.label}</p>
                          <p className="text-lg font-bold font-mono mt-0.5">
                            {m.value}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Notes */}
                  {details.notes && details.notes.length > 0 && (
                    <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-xs text-amber-800 dark:text-amber-300 space-y-1">
                      {details.notes.map((n, idx) => (
                        <p key={idx}>{n}</p>
                      ))}
                    </div>
                  )}

                  {/* Scan History */}
                  {details.scans.length > 0 && (
                    <div className="space-y-2">
                      <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                        Recent Scans ({details.scans.length})
                      </h3>
                      <div className="overflow-x-auto border border-gray-200 dark:border-gray-700 rounded-lg">
                        <table className="w-full text-left text-xs">
                          <thead className="bg-gray-50 dark:bg-gray-900/50 text-gray-500 dark:text-gray-400">
                            <tr>
                              <th className="px-3 py-2 font-medium">Scan ID</th>
                              <th className="px-3 py-2 font-medium">Status</th>
                              <th className="px-3 py-2 font-medium">Date</th>
                              <th className="px-3 py-2 font-medium">Details</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100 dark:divide-gray-700/70">
                            {details.scans.slice(0, 5).map((s) => (
                              <tr key={s.id}>
                                <td className="px-3 py-2 font-mono">{s.id}</td>
                                <td className="px-3 py-2">{s.status}</td>
                                <td className="px-3 py-2 font-mono text-gray-500">
                                  {s.date ? new Date(s.date).toLocaleString() : '-'}
                                </td>
                                <td className="px-3 py-2 font-mono text-gray-500">
                                  {s.loc ? `${s.loc.toLocaleString()} LOC` : s.riskScore !== undefined && s.riskScore !== null ? `Risk ${s.riskScore}` : '-'}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Findings */}
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                        Findings / Issues ({filteredFindings.length})
                      </h3>
                      <div className="flex items-center gap-2 flex-wrap">
                        <select
                          value={severityFilter}
                          onChange={(e) =>
                            setSeverityFilter(
                              e.target.value as 'ALL' | SecurityFinding['severity']
                            )
                          }
                          className="px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
                          aria-label="Filter severity"
                        >
                          <option value="ALL">All Severities</option>
                          <option value="CRITICAL">Critical</option>
                          <option value="HIGH">High</option>
                          <option value="MEDIUM">Medium</option>
                          <option value="LOW">Low</option>
                          <option value="INFO">Info</option>
                        </select>
                        <input
                          type="text"
                          value={findingQuery}
                          onChange={(e) => setFindingQuery(e.target.value)}
                          placeholder="Filter findings..."
                          className="px-2.5 py-1 text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
                        />
                      </div>
                    </div>

                    {filteredFindings.length === 0 ? (
                      <div className="p-4 text-xs text-gray-500 border border-gray-200 dark:border-gray-700 rounded-lg">
                        No findings match the current filter.
                      </div>
                    ) : (
                      <div className="overflow-x-auto border border-gray-200 dark:border-gray-700 rounded-lg max-h-96">
                        <table className="w-full text-left text-xs">
                          <thead className="bg-gray-50 dark:bg-gray-900/50 text-gray-500 dark:text-gray-400 sticky top-0">
                            <tr>
                              <th className="px-3 py-2 font-medium">Severity</th>
                              <th className="px-3 py-2 font-medium">Finding / CVE</th>
                              <th className="px-3 py-2 font-medium">Location / Package</th>
                              <th className="px-3 py-2 font-medium text-right">AI</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100 dark:divide-gray-700/70">
                            {filteredFindings.map((f) => (
                              <tr
                                key={f.id}
                                className="hover:bg-gray-50 dark:hover:bg-gray-700/30"
                              >
                                <td className="px-3 py-2 whitespace-nowrap">
                                  <span
                                    className={`px-2 py-0.5 rounded font-semibold ${getSeverityBadgeClass(
                                      f.severity
                                    )}`}
                                  >
                                    {f.severity}
                                  </span>
                                </td>
                                <td className="px-3 py-2">
                                  <p className="font-medium text-gray-900 dark:text-gray-100">
                                    {f.title}
                                  </p>
                                  <p className="text-[11px] text-gray-500 dark:text-gray-400">
                                    {f.category}
                                    {f.recommendation ? ` • ${f.recommendation}` : ''}
                                  </p>
                                </td>
                                <td className="px-3 py-2 font-mono text-gray-600 dark:text-gray-300 break-all max-w-xs">
                                  {f.location}
                                </td>
                                <td className="px-3 py-2 text-right whitespace-nowrap">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setAiFindingText(
                                        [
                                          `Provider: ${PROVIDER_LABELS[details.provider]}`,
                                          `Project: ${details.projectName}`,
                                          `Severity: ${f.severity}`,
                                          `Title: ${f.title}`,
                                          `Category: ${f.category}`,
                                          `Location/Package: ${f.location}`,
                                          f.recommendation
                                            ? `Recommendation: ${f.recommendation}`
                                            : '',
                                          f.description
                                            ? `Description: ${f.description}`
                                            : '',
                                        ]
                                          .filter(Boolean)
                                          .join('\n')
                                      )
                                    }
                                    className="px-2 py-1 rounded bg-purple-600 hover:bg-purple-700 text-white text-[11px]"
                                  >
                                    ✨ AI Fix
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </>
      )}

      {/* Add / Edit Connection Modal */}
      <SecurityConnectionModal
        isOpen={modalOpen}
        editingConnection={editingConn}
        onClose={() => setModalOpen(false)}
        onSaved={async (saved) => {
          setModalOpen(false);
          await loadConnections(saved.id);
        }}
      />

      {/* Delete Confirm Modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-black/60"
            onClick={() => setDeleteTarget(null)}
          />
          <div className="relative w-full max-w-sm bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-5 space-y-4 z-10">
            <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
              Delete Security Connection
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-300">
              Remove <strong>{deleteTarget.label}</strong> from Security Scans?
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="px-3 py-1.5 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeleteConfirmed}
                className="px-4 py-1.5 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* AI Remediation Modal */}
      <AIAnalyzeModal
        isOpen={Boolean(aiFindingText)}
        onClose={() => setAiFindingText(null)}
        logText={aiFindingText || ''}
      />
    </div>
  );
}
