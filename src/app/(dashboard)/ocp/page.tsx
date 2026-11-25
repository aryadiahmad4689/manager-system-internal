'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import OcpClusterModal from '@/components/ocp/OcpClusterModal';
import OcpPodLogsModal from '@/components/ocp/OcpPodLogsModal';
import OcpDescribeModal from '@/components/ocp/OcpDescribeModal';
import OcpConfigMapModal from '@/components/ocp/OcpConfigMapModal';
import type { OcpTerminalTab } from '@/components/ocp/OcpTerminalPanel';
import type {
  OcpClusterPublic,
  OcpConfigMap,
  OcpDeployment,
  OcpDescribeKind,
  OcpPod,
  OcpProject,
  OcpTestResult,
  OcpWorkloadsResponse,
} from '@/lib/ocp/types';

const OcpTerminalPanel = dynamic(
  () => import('@/components/ocp/OcpTerminalPanel'),
  { ssr: false }
);

type ResourceTab = 'pods' | 'deployments' | 'routes' | 'services' | 'configmaps';

function getPodStatusBadgeClass(status: string): string {
  if (status === 'Running' || status === 'Succeeded' || status === 'Completed') {
    return 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-800 dark:text-emerald-300';
  }
  if (
    status === 'Pending' ||
    status === 'ContainerCreating' ||
    status === 'Terminating' ||
    status.startsWith('Init:')
  ) {
    return 'bg-amber-100 dark:bg-amber-900/50 text-amber-800 dark:text-amber-300';
  }
  return 'bg-red-100 dark:bg-red-900/50 text-red-800 dark:text-red-300';
}

export default function OcpAccessPage() {
  const [clusters, setClusters] = useState<OcpClusterPublic[]>([]);
  const [selectedClusterId, setSelectedClusterId] = useState<string>('');
  const [loadingClusters, setLoadingClusters] = useState<boolean>(true);
  const [clusterStatus, setClusterStatus] = useState<Record<string, OcpTestResult>>({});
  const [testingClusterId, setTestingClusterId] = useState<string | null>(null);

  const [projects, setProjects] = useState<OcpProject[]>([]);
  const [selectedNamespace, setSelectedNamespace] = useState<string>('');
  const [loadingProjects, setLoadingProjects] = useState<boolean>(false);

  const [workloads, setWorkloads] = useState<OcpWorkloadsResponse | null>(null);
  const [loadingWorkloads, setLoadingWorkloads] = useState<boolean>(false);
  const [autoRefresh, setAutoRefresh] = useState<boolean>(false);

  const [activeTab, setActiveTab] = useState<ResourceTab>('pods');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [errorBanner, setErrorBanner] = useState<string>('');
  const [actionFeedback, setActionFeedback] = useState<string>('');

  // Modals
  const [clusterModalOpen, setClusterModalOpen] = useState<boolean>(false);
  const [editingCluster, setEditingCluster] = useState<OcpClusterPublic | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<OcpClusterPublic | null>(null);
  const [logsPod, setLogsPod] = useState<OcpPod | null>(null);
  const [selectedConfigMap, setSelectedConfigMap] = useState<OcpConfigMap | null>(null);
  const [describeTarget, setDescribeTarget] = useState<{
    kind: OcpDescribeKind;
    name: string;
  } | null>(null);
  const [scaleTarget, setScaleTarget] = useState<OcpDeployment | null>(null);
  const [scaleValue, setScaleValue] = useState<number>(1);
  const [deletePodTarget, setDeletePodTarget] = useState<OcpPod | null>(null);
  const [runningAction, setRunningAction] = useState<boolean>(false);

  // Pod terminal tabs
  const [terminalTabs, setTerminalTabs] = useState<OcpTerminalTab[]>([]);
  const [activeTerminalTabId, setActiveTerminalTabId] = useState<string | null>(null);
  const [isFullscreenTerminal, setIsFullscreenTerminal] = useState<boolean>(false);

  const activeCluster = useMemo(
    () => clusters.find((c) => c.id === selectedClusterId) || null,
    [clusters, selectedClusterId]
  );

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isFullscreenTerminal) {
        setIsFullscreenTerminal(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isFullscreenTerminal]);

  const loadClusters = useCallback(async (preferredId?: string) => {
    setLoadingClusters(true);
    setErrorBanner('');
    try {
      const res = await fetch('/api/ocp/clusters');
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to load OCP clusters');
      }
      const list = data as OcpClusterPublic[];
      setClusters(list);

      setSelectedClusterId((prev) => {
        if (preferredId && list.some((c) => c.id === preferredId)) return preferredId;
        if (prev && list.some((c) => c.id === prev)) return prev;
        return list[0]?.id || '';
      });
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Failed to load OCP clusters');
    } finally {
      setLoadingClusters(false);
    }
  }, []);

  useEffect(() => {
    loadClusters();
  }, [loadClusters]);

  const loadProjects = useCallback(async (cluster: OcpClusterPublic) => {
    setLoadingProjects(true);
    setErrorBanner('');
    setProjects([]);
    setSelectedNamespace('');
    setWorkloads(null);

    try {
      const res = await fetch(`/api/ocp/clusters/${cluster.id}/projects`);
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to load OCP projects');
      }
      const list: OcpProject[] = data.projects || [];
      setProjects(list);

      const savedNs =
        typeof window !== 'undefined'
          ? localStorage.getItem(`ocp-last-ns-${cluster.id}`)
          : null;

      const preferred =
        (cluster.defaultNamespace &&
          list.some((p) => p.name === cluster.defaultNamespace) &&
          cluster.defaultNamespace) ||
        (savedNs && list.some((p) => p.name === savedNs) && savedNs) ||
        list[0]?.name ||
        cluster.defaultNamespace ||
        '';

      setSelectedNamespace(preferred);
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Failed to load projects');
    } finally {
      setLoadingProjects(false);
    }
  }, []);

  useEffect(() => {
    if (activeCluster) {
      loadProjects(activeCluster);
    } else {
      setProjects([]);
      setSelectedNamespace('');
      setWorkloads(null);
    }
  }, [activeCluster, loadProjects]);

  const loadWorkloads = useCallback(
    async (clusterId: string, namespace: string, silent = false) => {
      if (!clusterId || !namespace) return;
      if (!silent) setLoadingWorkloads(true);
      setErrorBanner('');

      try {
        const res = await fetch(
          `/api/ocp/clusters/${clusterId}/resources?namespace=${encodeURIComponent(namespace)}`
        );
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || 'Failed to load namespace resources');
        }
        setWorkloads(data);
        if (typeof window !== 'undefined') {
          localStorage.setItem(`ocp-last-ns-${clusterId}`, namespace);
        }
      } catch (err) {
        setErrorBanner(
          err instanceof Error ? err.message : 'Failed to load namespace resources'
        );
      } finally {
        if (!silent) setLoadingWorkloads(false);
      }
    },
    []
  );

  useEffect(() => {
    if (selectedClusterId && selectedNamespace) {
      loadWorkloads(selectedClusterId, selectedNamespace);
    }
  }, [selectedClusterId, selectedNamespace, loadWorkloads]);

  useEffect(() => {
    if (!autoRefresh || !selectedClusterId || !selectedNamespace) return;
    const timer = setInterval(() => {
      loadWorkloads(selectedClusterId, selectedNamespace, true);
    }, 5000);
    return () => clearInterval(timer);
  }, [autoRefresh, selectedClusterId, selectedNamespace, loadWorkloads]);

  async function handleTestSavedCluster(clusterId: string) {
    setTestingClusterId(clusterId);
    setErrorBanner('');
    try {
      const res = await fetch(`/api/ocp/clusters/${clusterId}/test`, {
        method: 'POST',
      });
      const data: OcpTestResult = await res.json();
      setClusterStatus((prev) => ({ ...prev, [clusterId]: data }));
      if (!data.connected && data.error) {
        setErrorBanner(data.error);
      } else if (data.connected && activeCluster?.id === clusterId) {
        loadProjects(activeCluster);
      }
    } catch {
      setErrorBanner('Failed to test OCP cluster connection');
    } finally {
      setTestingClusterId(null);
    }
  }

  async function handleConfirmDeleteCluster() {
    if (!deleteTarget) return;
    try {
      const res = await fetch(`/api/ocp/clusters/${deleteTarget.id}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to delete cluster');
      }
      setDeleteTarget(null);
      await loadClusters();
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Failed to delete cluster');
    }
  }

  function handleOpenPodTerminal(pod: OcpPod) {
    if (!activeCluster) return;
    const tabId = `${activeCluster.id}-${pod.namespace}-${pod.name}-${Date.now()}`;
    const newTab: OcpTerminalTab = {
      id: tabId,
      clusterId: activeCluster.id,
      clusterLabel: activeCluster.label,
      namespace: pod.namespace,
      podName: pod.name,
      containers: pod.containers,
      container: pod.containers[0] || '',
      shell: '/bin/sh',
    };
    setTerminalTabs((prev) => [...prev, newTab]);
    setActiveTerminalTabId(tabId);
  }

  async function handleScaleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!scaleTarget || !selectedClusterId) return;
    setRunningAction(true);
    setErrorBanner('');
    try {
      const res = await fetch(`/api/ocp/clusters/${selectedClusterId}/actions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'scale',
          namespace: scaleTarget.namespace,
          kind: scaleTarget.kind,
          name: scaleTarget.name,
          replicas: scaleValue,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to scale deployment');
      setActionFeedback(data.message);
      setScaleTarget(null);
      await loadWorkloads(selectedClusterId, selectedNamespace, true);
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Failed to scale deployment');
    } finally {
      setRunningAction(false);
    }
  }

  async function handleRestartDeployment(dep: OcpDeployment) {
    if (!selectedClusterId) return;
    setRunningAction(true);
    setErrorBanner('');
    try {
      const res = await fetch(`/api/ocp/clusters/${selectedClusterId}/actions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'restart',
          namespace: dep.namespace,
          kind: dep.kind,
          name: dep.name,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to restart rollout');
      setActionFeedback(data.message);
      await loadWorkloads(selectedClusterId, selectedNamespace, true);
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Failed to restart rollout');
    } finally {
      setRunningAction(false);
    }
  }

  async function handleConfirmDeletePod() {
    if (!deletePodTarget || !selectedClusterId) return;
    setRunningAction(true);
    setErrorBanner('');
    try {
      const res = await fetch(`/api/ocp/clusters/${selectedClusterId}/actions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'delete-pod',
          namespace: deletePodTarget.namespace,
          name: deletePodTarget.name,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to delete pod');
      setActionFeedback(data.message);
      setDeletePodTarget(null);
      await loadWorkloads(selectedClusterId, selectedNamespace, true);
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Failed to delete pod');
    } finally {
      setRunningAction(false);
    }
  }

  const queryLower = searchQuery.trim().toLowerCase();
  const filteredPods = useMemo(
    () =>
      (workloads?.pods || []).filter(
        (p) =>
          !queryLower ||
          p.name.toLowerCase().includes(queryLower) ||
          p.status.toLowerCase().includes(queryLower)
      ),
    [workloads?.pods, queryLower]
  );

  const filteredDeployments = useMemo(
    () =>
      (workloads?.deployments || []).filter(
        (d) =>
          !queryLower ||
          d.name.toLowerCase().includes(queryLower) ||
          d.images.some((img) => img.toLowerCase().includes(queryLower))
      ),
    [workloads?.deployments, queryLower]
  );

  const filteredRoutes = useMemo(
    () =>
      (workloads?.routes || []).filter(
        (r) =>
          !queryLower ||
          r.name.toLowerCase().includes(queryLower) ||
          r.host.toLowerCase().includes(queryLower) ||
          r.targetService.toLowerCase().includes(queryLower)
      ),
    [workloads?.routes, queryLower]
  );

  const filteredServices = useMemo(
    () =>
      (workloads?.services || []).filter(
        (s) =>
          !queryLower ||
          s.name.toLowerCase().includes(queryLower) ||
          s.type.toLowerCase().includes(queryLower)
      ),
    [workloads?.services, queryLower]
  );

  const filteredConfigMaps = useMemo(
    () =>
      (workloads?.configMaps || []).filter(
        (cm) =>
          !queryLower ||
          cm.name.toLowerCase().includes(queryLower) ||
          Object.keys(cm.data).some((k) => k.toLowerCase().includes(queryLower)) ||
          cm.binaryKeys.some((k) => k.toLowerCase().includes(queryLower))
      ),
    [workloads?.configMaps, queryLower]
  );

  const activeStatus = activeCluster ? clusterStatus[activeCluster.id] : undefined;

  return (
    <div className="space-y-5">
      {/* Page Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            OCP Access
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Manage OpenShift clusters, inspect workloads, stream pod logs, and open container shells.
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            setEditingCluster(null);
            setClusterModalOpen(true);
          }}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors shadow-sm"
        >
          <span>+ Add Cluster</span>
        </button>
      </div>

      {/* Feedback & Error Banners */}
      {actionFeedback && (
        <div className="flex items-center justify-between p-3 text-sm text-emerald-800 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-200 dark:border-emerald-800 rounded-lg">
          <span>{actionFeedback}</span>
          <button
            type="button"
            onClick={() => setActionFeedback('')}
            className="text-xs underline"
          >
            Dismiss
          </button>
        </div>
      )}

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

      {/* Cluster & Namespace Controls */}
      {loadingClusters ? (
        <div className="p-6 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-sm text-gray-500 dark:text-gray-400">
          Loading registered OCP clusters...
        </div>
      ) : clusters.length === 0 ? (
        <div className="p-8 bg-white dark:bg-gray-800 border border-dashed border-gray-300 dark:border-gray-700 rounded-xl text-center space-y-3">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            No OpenShift clusters configured yet
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 max-w-lg mx-auto">
            Add your OpenShift cluster console URL along with your OAuth username/password or API Bearer token to explore pods, logs, routes, and terminal exec.
          </p>
          <button
            type="button"
            onClick={() => {
              setEditingCluster(null);
              setClusterModalOpen(true);
            }}
            className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg"
          >
            + Add Your First OCP Cluster
          </button>
        </div>
      ) : (
        <>
          {/* Cluster Toolbar */}
          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4 space-y-4">
            <div className="flex flex-wrap items-end gap-3 justify-between">
              <div className="flex flex-wrap items-end gap-3 flex-1 min-w-[260px]">
                <div className="min-w-[240px] flex-1 max-w-xs">
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                    Active OCP Cluster
                  </label>
                  <select
                    value={selectedClusterId}
                    onChange={(e) => setSelectedClusterId(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
                    aria-label="Active OCP Cluster"
                  >
                    {clusters.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label} ({c.authType === 'token' ? 'Token' : c.username || 'OAuth'})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="min-w-[220px] flex-1 max-w-xs">
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                    Project / Namespace {loadingProjects && '(loading...)'}
                  </label>
                  <select
                    value={selectedNamespace}
                    onChange={(e) => setSelectedNamespace(e.target.value)}
                    disabled={loadingProjects || projects.length === 0}
                    className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 disabled:opacity-50"
                    aria-label="Project or Namespace"
                  >
                    {projects.length === 0 ? (
                      <option value="">No projects loaded</option>
                    ) : (
                      projects.map((p) => (
                        <option key={p.name} value={p.name}>
                          {p.name}
                          {p.displayName && p.displayName !== p.name
                            ? ` (${p.displayName})`
                            : ''}
                        </option>
                      ))
                    )}
                  </select>
                </div>
              </div>

              {activeCluster && (
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleTestSavedCluster(activeCluster.id)}
                    disabled={testingClusterId === activeCluster.id}
                    className="px-3 py-2 text-xs font-medium rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/60"
                  >
                    {testingClusterId === activeCluster.id ? 'Testing...' : 'Test Connection'}
                  </button>
                  <a
                    href={activeCluster.consoleUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3 py-2 text-xs font-medium rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
                  >
                    Open Web Console ↗
                  </a>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingCluster(activeCluster);
                      setClusterModalOpen(true);
                    }}
                    className="px-3 py-2 text-xs font-medium rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleteTarget(activeCluster)}
                    className="px-3 py-2 text-xs font-medium rounded-lg bg-red-50 dark:bg-red-900/40 text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-900/60"
                  >
                    Delete
                  </button>
                </div>
              )}
            </div>

            {activeCluster && (
              <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-gray-100 dark:border-gray-700 text-xs text-gray-500 dark:text-gray-400">
                <div className="flex flex-wrap items-center gap-3">
                  <span>
                    API: <code className="font-mono text-gray-700 dark:text-gray-300">{activeCluster.apiUrl}</code>
                  </span>
                  <span>•</span>
                  <span>
                    Auth: <strong className="text-gray-700 dark:text-gray-300">{activeCluster.authType === 'token' ? 'Bearer Token' : `OAuth (${activeCluster.username})`}</strong>
                  </span>
                  {activeStatus && (
                    <>
                      <span>•</span>
                      <span
                        className={`px-2 py-0.5 rounded font-medium ${
                          activeStatus.connected
                            ? 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300'
                            : 'bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-300'
                        }`}
                      >
                        {activeStatus.connected
                          ? `Connected (${activeStatus.serverVersion || 'API OK'})`
                          : 'Connection Error'}
                      </span>
                    </>
                  )}
                </div>

                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={autoRefresh}
                      onChange={(e) => setAutoRefresh(e.target.checked)}
                      className="rounded border-gray-300 dark:border-gray-600"
                    />
                    <span>Auto-refresh (5s)</span>
                  </label>
                  <button
                    type="button"
                    onClick={() =>
                      selectedClusterId &&
                      selectedNamespace &&
                      loadWorkloads(selectedClusterId, selectedNamespace)
                    }
                    disabled={!selectedNamespace || loadingWorkloads}
                    className="px-2.5 py-1 rounded bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 disabled:opacity-50"
                  >
                    {loadingWorkloads ? 'Refreshing...' : 'Refresh'}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Resource Tabs & Search */}
          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-gray-200 dark:border-gray-700">
              <div className="flex items-center gap-1 flex-wrap">
                {(
                  [
                    ['pods', `Pods (${workloads?.pods.length ?? 0})`],
                    ['deployments', `Deployments (${workloads?.deployments.length ?? 0})`],
                    ['routes', `Routes (${workloads?.routes.length ?? 0})`],
                    ['services', `Services (${workloads?.services.length ?? 0})`],
                    ['configmaps', `ConfigMaps (${workloads?.configMaps?.length ?? 0})`],
                  ] as [ResourceTab, string][]
                ).map(([tabKey, tabLabel]) => (
                  <button
                    key={tabKey}
                    type="button"
                    onClick={() => setActiveTab(tabKey)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                      activeTab === tabKey
                        ? 'bg-red-600 text-white'
                        : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                    }`}
                  >
                    {tabLabel}
                  </button>
                ))}
              </div>

              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search resources..."
                className="px-3 py-1.5 text-xs rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 w-full sm:w-64"
              />
            </div>

            <div className="overflow-x-auto">
              {loadingWorkloads && !workloads ? (
                <div className="p-6 text-sm text-gray-500 dark:text-gray-400">
                  Loading resources in {selectedNamespace}...
                </div>
              ) : !selectedNamespace ? (
                <div className="p-6 text-sm text-gray-500 dark:text-gray-400">
                  Select a Project / Namespace to view workloads.
                </div>
              ) : activeTab === 'pods' ? (
                <table className="w-full text-left text-xs">
                  <thead className="bg-gray-50 dark:bg-gray-900/50 text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                    <tr>
                      <th className="px-4 py-3 font-medium">Pod Name</th>
                      <th className="px-4 py-3 font-medium">Status</th>
                      <th className="px-4 py-3 font-medium">Ready</th>
                      <th className="px-4 py-3 font-medium">Restarts</th>
                      <th className="px-4 py-3 font-medium">Pod IP</th>
                      <th className="px-4 py-3 font-medium">Node</th>
                      <th className="px-4 py-3 font-medium">Age</th>
                      <th className="px-4 py-3 font-medium text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-700/70">
                    {filteredPods.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="px-4 py-6 text-center text-gray-500">
                          No pods found.
                        </td>
                      </tr>
                    ) : (
                      filteredPods.map((pod) => (
                        <tr key={pod.name} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                          <td className="px-4 py-3 font-mono font-medium text-gray-900 dark:text-gray-100">
                            {pod.name}
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className={`px-2 py-0.5 rounded font-medium ${getPodStatusBadgeClass(
                                pod.status
                              )}`}
                            >
                              {pod.status}
                            </span>
                          </td>
                          <td className="px-4 py-3 font-mono text-gray-700 dark:text-gray-300">
                            {pod.ready}
                          </td>
                          <td className="px-4 py-3 font-mono text-gray-700 dark:text-gray-300">
                            {pod.restarts}
                          </td>
                          <td className="px-4 py-3 font-mono text-gray-500 dark:text-gray-400">
                            {pod.podIP || '-'}
                          </td>
                          <td className="px-4 py-3 font-mono text-gray-500 dark:text-gray-400">
                            {pod.nodeName || '-'}
                          </td>
                          <td className="px-4 py-3 font-mono text-gray-500 dark:text-gray-400">
                            {pod.age}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                type="button"
                                onClick={() => setLogsPod(pod)}
                                className="px-2 py-1 rounded bg-blue-50 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/60"
                              >
                                Logs
                              </button>
                              <button
                                type="button"
                                onClick={() => handleOpenPodTerminal(pod)}
                                className="px-2 py-1 rounded bg-emerald-50 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/60"
                              >
                                Terminal
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  setDescribeTarget({ kind: 'Pod', name: pod.name })
                                }
                                className="px-2 py-1 rounded bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600"
                              >
                                Describe
                              </button>
                              <button
                                type="button"
                                onClick={() => setDeletePodTarget(pod)}
                                className="px-2 py-1 rounded bg-red-50 dark:bg-red-900/40 text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-900/60"
                              >
                                Delete
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              ) : activeTab === 'deployments' ? (
                <table className="w-full text-left text-xs">
                  <thead className="bg-gray-50 dark:bg-gray-900/50 text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                    <tr>
                      <th className="px-4 py-3 font-medium">Name</th>
                      <th className="px-4 py-3 font-medium">Kind</th>
                      <th className="px-4 py-3 font-medium">Ready</th>
                      <th className="px-4 py-3 font-medium">Images</th>
                      <th className="px-4 py-3 font-medium">Age</th>
                      <th className="px-4 py-3 font-medium text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-700/70">
                    {filteredDeployments.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-4 py-6 text-center text-gray-500">
                          No deployments found.
                        </td>
                      </tr>
                    ) : (
                      filteredDeployments.map((dep) => (
                        <tr
                          key={`${dep.kind}-${dep.name}`}
                          className="hover:bg-gray-50 dark:hover:bg-gray-700/30"
                        >
                          <td className="px-4 py-3 font-mono font-medium text-gray-900 dark:text-gray-100">
                            {dep.name}
                          </td>
                          <td className="px-4 py-3 text-gray-600 dark:text-gray-300">
                            {dep.kind}
                          </td>
                          <td className="px-4 py-3 font-mono text-gray-700 dark:text-gray-300">
                            {dep.readyReplicas}/{dep.replicas}
                          </td>
                          <td className="px-4 py-3 font-mono text-gray-500 dark:text-gray-400 max-w-sm truncate">
                            {dep.images.join(', ') || '-'}
                          </td>
                          <td className="px-4 py-3 font-mono text-gray-500 dark:text-gray-400">
                            {dep.age}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                type="button"
                                onClick={() => {
                                  setScaleTarget(dep);
                                  setScaleValue(dep.replicas);
                                }}
                                className="px-2 py-1 rounded bg-blue-50 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 hover:bg-blue-100"
                              >
                                Scale
                              </button>
                              <button
                                type="button"
                                disabled={runningAction}
                                onClick={() => handleRestartDeployment(dep)}
                                className="px-2 py-1 rounded bg-amber-50 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 hover:bg-amber-100 disabled:opacity-50"
                              >
                                Restart
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  setDescribeTarget({ kind: dep.kind, name: dep.name })
                                }
                                className="px-2 py-1 rounded bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200"
                              >
                                Describe
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              ) : activeTab === 'routes' ? (
                <table className="w-full text-left text-xs">
                  <thead className="bg-gray-50 dark:bg-gray-900/50 text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                    <tr>
                      <th className="px-4 py-3 font-medium">Route Name</th>
                      <th className="px-4 py-3 font-medium">URL</th>
                      <th className="px-4 py-3 font-medium">TLS</th>
                      <th className="px-4 py-3 font-medium">Target Service</th>
                      <th className="px-4 py-3 font-medium">Age</th>
                      <th className="px-4 py-3 font-medium text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-700/70">
                    {filteredRoutes.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-4 py-6 text-center text-gray-500">
                          No routes found.
                        </td>
                      </tr>
                    ) : (
                      filteredRoutes.map((route) => (
                        <tr
                          key={route.name}
                          className="hover:bg-gray-50 dark:hover:bg-gray-700/30"
                        >
                          <td className="px-4 py-3 font-mono font-medium text-gray-900 dark:text-gray-100">
                            {route.name}
                          </td>
                          <td className="px-4 py-3 font-mono">
                            {route.url ? (
                              <a
                                href={route.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-blue-600 dark:text-blue-400 hover:underline"
                              >
                                {route.url} ↗
                              </a>
                            ) : (
                              '-'
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className={`px-2 py-0.5 rounded font-medium ${
                                route.tls
                                  ? 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300'
                                  : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300'
                              }`}
                            >
                              {route.tls ? 'HTTPS' : 'HTTP'}
                            </span>
                          </td>
                          <td className="px-4 py-3 font-mono text-gray-700 dark:text-gray-300">
                            {route.targetService}:{route.targetPort}
                          </td>
                          <td className="px-4 py-3 font-mono text-gray-500 dark:text-gray-400">
                            {route.age}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <button
                              type="button"
                              onClick={() =>
                                setDescribeTarget({ kind: 'Route', name: route.name })
                              }
                              className="px-2 py-1 rounded bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200"
                            >
                              Describe
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              ) : activeTab === 'services' ? (
                <table className="w-full text-left text-xs">
                  <thead className="bg-gray-50 dark:bg-gray-900/50 text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                    <tr>
                      <th className="px-4 py-3 font-medium">Service Name</th>
                      <th className="px-4 py-3 font-medium">Type</th>
                      <th className="px-4 py-3 font-medium">Cluster IP</th>
                      <th className="px-4 py-3 font-medium">Ports</th>
                      <th className="px-4 py-3 font-medium">Age</th>
                      <th className="px-4 py-3 font-medium text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-700/70">
                    {filteredServices.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-4 py-6 text-center text-gray-500">
                          No services found.
                        </td>
                      </tr>
                    ) : (
                      filteredServices.map((svc) => (
                        <tr
                          key={svc.name}
                          className="hover:bg-gray-50 dark:hover:bg-gray-700/30"
                        >
                          <td className="px-4 py-3 font-mono font-medium text-gray-900 dark:text-gray-100">
                            {svc.name}
                          </td>
                          <td className="px-4 py-3 text-gray-700 dark:text-gray-300">
                            {svc.type}
                          </td>
                          <td className="px-4 py-3 font-mono text-gray-600 dark:text-gray-400">
                            {svc.clusterIP || '-'}
                          </td>
                          <td className="px-4 py-3 font-mono text-gray-600 dark:text-gray-400">
                            {svc.ports.join(', ') || '-'}
                          </td>
                          <td className="px-4 py-3 font-mono text-gray-500 dark:text-gray-400">
                            {svc.age}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <button
                              type="button"
                              onClick={() =>
                                setDescribeTarget({ kind: 'Service', name: svc.name })
                              }
                              className="px-2 py-1 rounded bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200"
                            >
                              Describe
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              ) : (
                <table className="w-full text-left text-xs">
                  <thead className="bg-gray-50 dark:bg-gray-900/50 text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                    <tr>
                      <th className="px-4 py-3 font-medium">ConfigMap Name</th>
                      <th className="px-4 py-3 font-medium">Keys</th>
                      <th className="px-4 py-3 font-medium">Mode</th>
                      <th className="px-4 py-3 font-medium">Age</th>
                      <th className="px-4 py-3 font-medium text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-700/70">
                    {filteredConfigMaps.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-4 py-6 text-center text-gray-500">
                          No ConfigMaps found.
                        </td>
                      </tr>
                    ) : (
                      filteredConfigMaps.map((cm) => {
                        const allKeys = [...Object.keys(cm.data), ...cm.binaryKeys];
                        const previewKeys = allKeys.slice(0, 4);
                        return (
                          <tr
                            key={cm.name}
                            className="hover:bg-gray-50 dark:hover:bg-gray-700/30"
                          >
                            <td className="px-4 py-3 font-mono font-medium text-gray-900 dark:text-gray-100">
                              {cm.name}
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="px-1.5 py-0.5 rounded bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300 font-semibold">
                                  {cm.keyCount}
                                </span>
                                {previewKeys.map((k) => (
                                  <span
                                    key={k}
                                    className="px-1.5 py-0.5 rounded font-mono bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300"
                                  >
                                    {k}
                                  </span>
                                ))}
                                {allKeys.length > 4 && (
                                  <span className="text-gray-500 dark:text-gray-400">
                                    +{allKeys.length - 4} more
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="px-4 py-3">
                              <span
                                className={`px-2 py-0.5 rounded font-medium ${
                                  cm.immutable
                                    ? 'bg-amber-100 dark:bg-amber-900/50 text-amber-800 dark:text-amber-300'
                                    : 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300'
                                }`}
                              >
                                {cm.immutable ? 'Immutable' : 'Editable'}
                              </span>
                            </td>
                            <td className="px-4 py-3 font-mono text-gray-500 dark:text-gray-400">
                              {cm.age}
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex items-center justify-end gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => setSelectedConfigMap(cm)}
                                  className="px-2 py-1 rounded bg-indigo-50 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-900/60"
                                >
                                  {cm.immutable ? 'View' : 'View / Edit'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setDescribeTarget({
                                      kind: 'ConfigMap',
                                      name: cm.name,
                                    })
                                  }
                                  className="px-2 py-1 rounded bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600"
                                >
                                  Describe
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </>
      )}

      {/* Pod Terminal Panel */}
      <OcpTerminalPanel
        tabs={terminalTabs}
        activeTabId={activeTerminalTabId}
        onSelectTab={setActiveTerminalTabId}
        onCloseTab={(tabId) => {
          setTerminalTabs((prev) => {
            const next = prev.filter((t) => t.id !== tabId);
            if (activeTerminalTabId === tabId) {
              setActiveTerminalTabId(next[next.length - 1]?.id || null);
            }
            if (next.length === 0) setIsFullscreenTerminal(false);
            return next;
          });
        }}
        onChangeTabConfig={(tabId, patch) => {
          setTerminalTabs((prev) =>
            prev.map((t) => (t.id === tabId ? { ...t, ...patch } : t))
          );
        }}
        isFullscreen={isFullscreenTerminal}
        onToggleFullscreen={() => setIsFullscreenTerminal((v) => !v)}
      />

      {/* Add / Edit Cluster Modal */}
      <OcpClusterModal
        isOpen={clusterModalOpen}
        editingCluster={editingCluster}
        onClose={() => setClusterModalOpen(false)}
        onSaved={async (saved) => {
          setClusterModalOpen(false);
          await loadClusters(saved.id);
        }}
      />

      {/* Pod Logs Modal */}
      {logsPod && activeCluster && (
        <OcpPodLogsModal
          clusterId={activeCluster.id}
          clusterLabel={activeCluster.label}
          pod={logsPod}
          onClose={() => setLogsPod(null)}
        />
      )}

      {/* ConfigMap View / Edit Modal */}
      {selectedConfigMap && activeCluster && (
        <OcpConfigMapModal
          clusterId={activeCluster.id}
          clusterLabel={activeCluster.label}
          namespace={selectedConfigMap.namespace}
          configMapName={selectedConfigMap.name}
          onClose={() => setSelectedConfigMap(null)}
          onSaved={async () => {
            setActionFeedback(`ConfigMap ${selectedConfigMap.name} updated`);
            if (selectedClusterId && selectedNamespace) {
              await loadWorkloads(selectedClusterId, selectedNamespace, true);
            }
          }}
        />
      )}

      {/* Describe Resource Modal */}
      {describeTarget && activeCluster && selectedNamespace && (
        <OcpDescribeModal
          clusterId={activeCluster.id}
          namespace={selectedNamespace}
          kind={describeTarget.kind}
          name={describeTarget.name}
          onClose={() => setDescribeTarget(null)}
        />
      )}

      {/* Scale Deployment Modal */}
      {scaleTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/60" onClick={() => setScaleTarget(null)} />
          <form
            onSubmit={handleScaleSubmit}
            className="relative w-full max-w-sm bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-5 space-y-4 z-10"
          >
            <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
              Scale {scaleTarget.kind}: {scaleTarget.name}
            </h3>
            <div>
              <label className="block text-sm text-gray-600 dark:text-gray-300 mb-1">
                Replicas (0 - 50)
              </label>
              <input
                type="number"
                min={0}
                max={50}
                value={scaleValue}
                onChange={(e) => setScaleValue(Number(e.target.value))}
                className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setScaleTarget(null)}
                className="px-3 py-1.5 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={runningAction}
                className="px-4 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50"
              >
                {runningAction ? 'Scaling...' : 'Apply Scale'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Delete Cluster Confirm Modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/60" onClick={() => setDeleteTarget(null)} />
          <div className="relative w-full max-w-sm bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-5 space-y-4 z-10">
            <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
              Delete OCP Cluster
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-300">
              Remove <strong>{deleteTarget.label}</strong> from saved OCP clusters?
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
                onClick={handleConfirmDeleteCluster}
                className="px-4 py-1.5 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Pod Confirm Modal */}
      {deletePodTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/60" onClick={() => setDeletePodTarget(null)} />
          <div className="relative w-full max-w-sm bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-5 space-y-4 z-10">
            <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
              Delete Pod
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-300">
              Delete pod <code className="font-mono">{deletePodTarget.name}</code> in{' '}
              <code className="font-mono">{deletePodTarget.namespace}</code>?
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeletePodTarget(null)}
                className="px-3 py-1.5 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={runningAction}
                onClick={handleConfirmDeletePod}
                className="px-4 py-1.5 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg disabled:opacity-50"
              >
                {runningAction ? 'Deleting...' : 'Delete Pod'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
