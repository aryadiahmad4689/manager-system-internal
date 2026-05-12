'use client';

import { useState, useCallback, useEffect } from 'react';
import dynamic from 'next/dynamic';
import ConnectionList from '@/components/db/ConnectionList';
import QueryResults from '@/components/db/QueryResults';
import QueryHistory from '@/components/db/QueryHistory';
import ConnectionForm from '@/components/db/ConnectionForm';
import type { ConnectionItem } from '@/components/db/ConnectionList';
import type { ColumnInfo } from '@/components/db/database-tree-utils';
import type { QueryResult } from '@/components/db/QueryResults';
import type { QueryHistoryEntry } from '@/components/db/QueryHistory';
import type { ConnectionFormData } from '@/components/db/ConnectionForm';

// Dynamically import SQLEditor to avoid SSR issues with CodeMirror
const SQLEditor = dynamic(() => import('@/components/db/SQLEditor'), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-[200px] border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-800">
      <span className="text-sm text-gray-500 dark:text-gray-400">Loading editor...</span>
    </div>
  ),
});

/** State for the active panel in the main area */
type MainPanel = 'results' | 'history';

export default function DatabaseManagementPage() {
  // Connection state
  const [connections, setConnections] = useState<ConnectionItem[]>([]);
  const [activeConnectionId, setActiveConnectionId] = useState<string | null>(null);
  const [isLoadingConnections, setIsLoadingConnections] = useState(false);

  // Connection form state
  const [showConnectionForm, setShowConnectionForm] = useState(false);
  const [editConnectionId, setEditConnectionId] = useState<string | null>(null);

  // Database tree state — grouped by connection ID
  const [connectionDatabases, setConnectionDatabases] = useState<Record<string, string[]>>({});
  const [tables, setTables] = useState<Record<string, string[]>>({});
  const [tableStructure, setTableStructure] = useState<Record<string, ColumnInfo[]>>({});
  const [accessDenied, setAccessDenied] = useState<string[]>([]);
  const [treeLoading, setTreeLoading] = useState<Record<string, boolean>>({});

  // Query state
  const [sqlValue, setSqlValue] = useState('');
  const [queryResult, setQueryResult] = useState<QueryResult | null>(null);
  const [queryError, setQueryError] = useState<string | null>(null);
  const [isExecutingQuery, setIsExecutingQuery] = useState(false);

  // History state
  const [queryHistory, setQueryHistory] = useState<QueryHistoryEntry[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);

  // UI state
  const [activePanel, setActivePanel] = useState<MainPanel>('results');
  const [treeSearchQuery, setTreeSearchQuery] = useState('');

  // Error state
  const [apiError, setApiError] = useState<string | null>(null);

  // --- Fetch status for a single connection ---
  const fetchConnectionStatus = useCallback(async (id: string): Promise<ConnectionItem['status']> => {
    try {
      const res = await fetch(`/api/databases/${id}/status`);
      if (!res.ok) return 'disconnected';
      const data = await res.json();
      return data.status || 'disconnected';
    } catch {
      return 'disconnected';
    }
  }, []);

  // --- Fetch statuses for all connections and update state ---
  const fetchAllStatuses = useCallback(async (conns: ConnectionItem[]) => {
    if (conns.length === 0) return;

    const statusResults = await Promise.allSettled(
      conns.map(async (conn) => ({
        id: conn.id,
        status: await fetchConnectionStatus(conn.id),
      }))
    );

    setConnections((prev) =>
      prev.map((conn) => {
        const result = statusResults.find(
          (r) => r.status === 'fulfilled' && r.value.id === conn.id
        );
        if (result && result.status === 'fulfilled') {
          return { ...conn, status: result.value.status };
        }
        return conn;
      })
    );
  }, [fetchConnectionStatus]);

  // --- Load connections on mount ---
  const fetchConnections = useCallback(async () => {
    setIsLoadingConnections(true);
    setApiError(null);
    try {
      const res = await fetch('/api/databases');
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to load connections');
      }
      const data = await res.json();
      const loadedConnections: ConnectionItem[] = data.map((c: any) => ({
        id: c.id,
        label: c.label,
        dbType: c.dbType,
        host: c.host,
        port: c.port,
        username: c.username,
        status: c.status || 'disconnected',
      }));
      setConnections(loadedConnections);
      // Fetch actual statuses for all connections after loading the list
      fetchAllStatuses(loadedConnections);
    } catch (err: any) {
      setApiError(err.message || 'Failed to load connections');
    } finally {
      setIsLoadingConnections(false);
    }
  }, [fetchAllStatuses]);

  // --- Load VMs for the form ---
  // (VM selection removed from database form)

  useEffect(() => {
    fetchConnections();
  }, [fetchConnections]);

  // --- Connection handlers ---
  const handleConnect = useCallback(async (id: string) => {
    setApiError(null);
    setActiveConnectionId(id);
    try {
      const res = await fetch(`/api/databases/${id}/connect`, { method: 'POST' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to connect');
      }
      // Update status to connected
      setConnections((prev) =>
        prev.map((c) => (c.id === id ? { ...c, status: 'connected' as const } : c))
      );
      // Fetch database list after successful connection
      try {
        const schemaRes = await fetch(`/api/databases/${id}/schema`);
        if (schemaRes.ok) {
          const schemaData = await schemaRes.json();
          setConnectionDatabases((prev) => ({ ...prev, [id]: schemaData.databases || [] }));
        }
      } catch {
        // Silently fail — tree will just be empty
      }
    } catch (err: any) {
      setApiError(err.message || 'Failed to connect');
      setActiveConnectionId(null);
    }
  }, []);

  const handleDisconnect = useCallback(async (id: string) => {
    setApiError(null);
    try {
      const res = await fetch(`/api/databases/${id}/disconnect`, { method: 'POST' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to disconnect');
      }
      // Update status to disconnected
      setConnections((prev) =>
        prev.map((c) => (c.id === id ? { ...c, status: 'disconnected' as const } : c))
      );
      if (activeConnectionId === id) {
        setActiveConnectionId(null);
      }
      // Clean up tree data for this connection
      setConnectionDatabases((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    } catch (err: any) {
      setApiError(err.message || 'Failed to disconnect');
    }
  }, [activeConnectionId]);

  const handleEdit = useCallback((id: string) => {
    setEditConnectionId(id);
    setShowConnectionForm(true);
  }, []);

  // Wire to DELETE /api/databases/[id]
  const handleDelete = useCallback(async (id: string) => {
    setApiError(null);
    try {
      const res = await fetch(`/api/databases/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to delete connection');
      }
      // Remove from local state
      setConnections((prev) => prev.filter((c) => c.id !== id));
      if (activeConnectionId === id) {
        setActiveConnectionId(null);
      }
      // Clean up tree data for this connection
      setConnectionDatabases((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    } catch (err: any) {
      setApiError(err.message || 'Failed to delete connection');
    }
  }, [activeConnectionId]);

  // Wire to POST /api/databases (create) or PUT /api/databases/[id] (edit)
  const handleConnectionFormSubmit = useCallback(async (data: ConnectionFormData) => {
    setApiError(null);
    try {
      const isEdit = !!editConnectionId;
      const url = isEdit ? `/api/databases/${editConnectionId}` : '/api/databases';
      const method = isEdit ? 'PUT' : 'POST';

      const body: Record<string, any> = {
        dbType: data.dbType,
        host: data.host,
        port: data.port,
        username: data.username,
      };
      // Only include password if provided (edit mode allows blank to keep current)
      if (data.password) {
        body.password = data.password;
      }

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `Failed to ${isEdit ? 'update' : 'create'} connection`);
      }

      setShowConnectionForm(false);
      setEditConnectionId(null);
      // Refresh the connections list to show the new/updated connection
      await fetchConnections();
    } catch (err: any) {
      setApiError(err.message || 'Failed to save connection');
    }
  }, [editConnectionId, fetchConnections]);

  const handleConnectionFormCancel = useCallback(() => {
    setShowConnectionForm(false);
    setEditConnectionId(null);
  }, []);

  // --- Tree view handlers ---
  const handleExpandConnection = useCallback(async (connId: string) => {
    // If we already have databases for this connection, don't refetch
    if (connectionDatabases[connId]) return;
    setTreeLoading((prev) => ({ ...prev, [connId]: true }));
    try {
      const res = await fetch(`/api/databases/${connId}/schema`);
      if (res.ok) {
        const data = await res.json();
        setConnectionDatabases((prev) => ({ ...prev, [connId]: data.databases || [] }));
      }
    } catch {
      // Silently fail
    } finally {
      setTreeLoading((prev) => ({ ...prev, [connId]: false }));
    }
  }, [connectionDatabases]);

  const handleExpandDatabaseForConn = useCallback(async (connId: string, dbName: string) => {
    setActiveConnectionId(connId);
    const key = `${connId}.${dbName}`;
    setTreeLoading((prev) => ({ ...prev, [key]: true }));
    try {
      const res = await fetch(`/api/databases/${connId}/schema/${encodeURIComponent(dbName)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.error?.toLowerCase().includes('access denied')) {
          setAccessDenied((prev) => [...prev, key]);
        } else {
          setApiError(data.error || 'Failed to load tables');
        }
        return;
      }
      setTables((prev) => ({ ...prev, [key]: data.tables || [] }));
    } catch (err: any) {
      setApiError(err.message || 'Failed to load tables');
    } finally {
      setTreeLoading((prev) => ({ ...prev, [key]: false }));
    }
  }, []);

  const handleExpandTableForConn = useCallback(async (connId: string, dbName: string, tableName: string) => {
    setActiveConnectionId(connId);
    const key = `${connId}.${dbName}.${tableName}`;
    setTreeLoading((prev) => ({ ...prev, [key]: true }));
    try {
      const res = await fetch(
        `/api/databases/${connId}/schema/${encodeURIComponent(dbName)}/${encodeURIComponent(tableName)}`
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setApiError(data.error || 'Failed to load columns');
        return;
      }
      const data = await res.json();
      setTableStructure((prev) => ({ ...prev, [key]: data.columns || [] }));
    } catch (err: any) {
      setApiError(err.message || 'Failed to load columns');
    } finally {
      setTreeLoading((prev) => ({ ...prev, [key]: false }));
    }
  }, []);

  // --- Fetch query history ---
  const fetchHistory = useCallback(async () => {
    if (!activeConnectionId) return;
    setIsLoadingHistory(true);
    try {
      const res = await fetch(`/api/databases/${activeConnectionId}/history`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to load history');
      }
      const data = await res.json();
      setQueryHistory(data);
    } catch {
      // Silently fail — history panel will just be empty
    } finally {
      setIsLoadingHistory(false);
    }
  }, [activeConnectionId]);

  // Load history when active connection changes
  useEffect(() => {
    if (activeConnectionId) {
      fetchHistory();
    } else {
      setQueryHistory([]);
    }
  }, [activeConnectionId, fetchHistory]);

  // --- Query handlers ---
  const handlePreviewTable = useCallback(async (connId: string, dbName: string, tableName: string) => {
    setActiveConnectionId(connId);
    setIsExecutingQuery(true);
    setQueryError(null);
    setQueryResult(null);
    setActivePanel('results');

    const sql = `SELECT * FROM \`${dbName}\`.\`${tableName}\` LIMIT 300`;
    setSqlValue(sql);

    try {
      const res = await fetch(`/api/databases/${connId}/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql, database: dbName }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Query execution failed');
      }

      const result = await res.json();
      setQueryResult(result);
    } catch (err: any) {
      setQueryError(err.message || 'Query execution failed');
    } finally {
      setIsExecutingQuery(false);
      fetchHistory();
    }
  }, [fetchHistory]);

  const handleRunQuery = useCallback(async (selectedText?: string) => {
    // If selectedText is empty string, it means nothing was selected — show warning
    if (selectedText !== undefined && selectedText.trim() === '') {
      setQueryError('Blok/select query yang ingin dijalankan terlebih dahulu');
      setQueryResult(null);
      setActivePanel('results');
      return;
    }

    const queryToRun = selectedText ? selectedText.trim() : sqlValue.trim();
    if (!queryToRun || !activeConnectionId) return;

    setIsExecutingQuery(true);
    setQueryError(null);
    setQueryResult(null);
    setActivePanel('results');

    try {
      const res = await fetch(`/api/databases/${activeConnectionId}/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql: queryToRun }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Query execution failed');
      }

      const result = await res.json();
      setQueryResult(result);
    } catch (err: any) {
      setQueryError(err.message || 'Query execution failed');
    } finally {
      setIsExecutingQuery(false);
      // Auto-refresh history after each execution
      fetchHistory();
    }
  }, [sqlValue, activeConnectionId, fetchHistory]);

  // Wire to POST /api/databases/[id]/export and trigger file download
  const handleExport = useCallback(async () => {
    if (!queryResult || !activeConnectionId) return;
    try {
      const res = await fetch(`/api/databases/${activeConnectionId}/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          columns: queryResult.columns,
          rows: queryResult.rows,
          database: 'query_result',
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Export failed');
      }

      // Get the filename from Content-Disposition header
      const disposition = res.headers.get('Content-Disposition');
      let filename = 'export.csv';
      if (disposition) {
        const match = disposition.match(/filename="?([^"]+)"?/);
        if (match) {
          filename = match[1];
        }
      }

      // Trigger file download
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      setApiError(err.message || 'Export failed');
    }
  }, [queryResult, activeConnectionId]);

  // History click fills editor
  const handleSelectHistoryQuery = useCallback((queryText: string) => {
    setSqlValue(queryText);
  }, []);

  return (
    <div className="flex flex-col h-full min-h-0 min-w-[1024px] overflow-hidden">
      {/* Page header */}
      <div className="flex items-center justify-between mb-4 flex-shrink-0">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          Database Management
        </h1>
        <button
          onClick={() => {
            setEditConnectionId(null);
            setShowConnectionForm(true);
          }}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add Connection
        </button>
      </div>

      {/* API Error display */}
      {apiError && (
        <div className="mb-4 flex-shrink-0 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md flex items-center justify-between">
          <p className="text-sm text-red-700 dark:text-red-400">{apiError}</p>
          <button
            onClick={() => setApiError(null)}
            className="text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-200 ml-2"
            aria-label="Dismiss error"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* Main layout: sidebar + content */}
      <div className="flex flex-1 gap-4 min-h-0">
        {/* Left sidebar */}
        <aside className="w-[300px] flex-shrink-0 flex flex-col gap-4 min-h-0 overflow-hidden">
          {/* Connection List */}
          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-3 flex-shrink-0 max-h-[200px] overflow-y-auto">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
              Connections
            </h2>
            {isLoadingConnections ? (
              <div className="flex items-center justify-center py-6">
                <LoadingSpinner />
                <span className="ml-2 text-sm text-gray-500 dark:text-gray-400">
                  Loading connections...
                </span>
              </div>
            ) : (
              <ConnectionList
                connections={connections}
                onConnect={handleConnect}
                onDisconnect={handleDisconnect}
                onEdit={handleEdit}
                onDelete={handleDelete}
              />
            )}
          </div>

          {/* Database Tree View - grouped by connection */}
          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg flex-1 min-h-0 flex flex-col overflow-hidden">
            <div className="p-3 pb-2 flex-shrink-0">
              <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                Database Explorer
              </h2>
              {/* Search input */}
              {connections.filter((c) => c.status === 'connected').length > 0 && (
                <input
                  type="text"
                  value={treeSearchQuery}
                  onChange={(e) => setTreeSearchQuery(e.target.value)}
                  placeholder="Search databases, tables..."
                  className="w-full px-2.5 py-1.5 text-xs bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                />
              )}
            </div>
            <div className="flex-1 overflow-y-auto px-3 pb-3">
              {connections.filter((c) => c.status === 'connected').length > 0 ? (
                <ConnectionTreeView
                  connections={connections.filter((c) => c.status === 'connected')}
                  connectionDatabases={connectionDatabases}
                  tables={tables}
                  tableStructure={tableStructure}
                  accessDenied={accessDenied}
                  treeLoading={treeLoading}
                  activeConnectionId={activeConnectionId}
                  searchQuery={treeSearchQuery}
                  onExpandConnection={handleExpandConnection}
                  onExpandDatabase={handleExpandDatabaseForConn}
                  onExpandTable={handleExpandTableForConn}
                  onPreviewTable={handlePreviewTable}
                  onSelectConnection={(connId) => setActiveConnectionId(connId)}
                />
              ) : (
                <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-4">
                  Connect to a database to browse its schema.
                </p>
              )}
            </div>
          </div>
        </aside>

        {/* Main content area */}
        <div className="flex-1 flex flex-col gap-4 min-w-0 min-h-0">
          {/* SQL Editor */}
          <div className="flex-shrink-0">
            <SQLEditor
              value={sqlValue}
              onChange={setSqlValue}
              onRun={handleRunQuery}
              disabled={!activeConnectionId}
              placeholder={
                activeConnectionId
                  ? 'Enter SQL query...'
                  : 'Connect to a database to run queries'
              }
            />
          </div>

          {/* Results / History panel tabs */}
          <div className="flex-1 flex flex-col min-h-0">
            {/* Tab bar */}
            <div className="flex border-b border-gray-200 dark:border-gray-700 mb-2 flex-shrink-0">
              <button
                type="button"
                onClick={() => setActivePanel('results')}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                  activePanel === 'results'
                    ? 'border-blue-600 text-blue-600 dark:text-blue-400 dark:border-blue-400'
                    : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                }`}
              >
                Results
              </button>
              <button
                type="button"
                onClick={() => setActivePanel('history')}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                  activePanel === 'history'
                    ? 'border-blue-600 text-blue-600 dark:text-blue-400 dark:border-blue-400'
                    : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                }`}
              >
                History
              </button>
            </div>

            {/* Panel content */}
            <div className="flex-1 overflow-auto">
              {activePanel === 'results' && (
                <QueryResults
                  result={queryResult}
                  error={queryError}
                  isLoading={isExecutingQuery}
                  onExport={handleExport}
                />
              )}
              {activePanel === 'history' && (
                <QueryHistory
                  entries={queryHistory}
                  onSelectQuery={handleSelectHistoryQuery}
                  isLoading={isLoadingHistory}
                />
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Connection Form Modal */}
      {showConnectionForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-black/60"
            onClick={handleConnectionFormCancel}
            aria-hidden="true"
          />
          <div className="relative w-full max-w-md bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
                {editConnectionId ? 'Edit Connection' : 'Add Connection'}
              </h2>
              <button
                onClick={handleConnectionFormCancel}
                className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                aria-label="Close"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <ConnectionForm
              onSubmit={handleConnectionFormSubmit}
              onCancel={handleConnectionFormCancel}
            />
          </div>
        </div>
      )}
    </div>
  );
}

/** Connection-grouped tree view for Database Explorer */
interface ConnectionTreeViewProps {
  connections: ConnectionItem[];
  connectionDatabases: Record<string, string[]>;
  tables: Record<string, string[]>;
  tableStructure: Record<string, ColumnInfo[]>;
  accessDenied: string[];
  treeLoading: Record<string, boolean>;
  activeConnectionId: string | null;
  searchQuery: string;
  onExpandConnection: (connId: string) => void;
  onExpandDatabase: (connId: string, dbName: string) => void;
  onExpandTable: (connId: string, dbName: string, tableName: string) => void;
  onPreviewTable: (connId: string, dbName: string, tableName: string) => void;
  onSelectConnection: (connId: string) => void;
}

function ConnectionTreeView({
  connections,
  connectionDatabases,
  tables,
  tableStructure,
  accessDenied,
  treeLoading,
  activeConnectionId,
  searchQuery,
  onExpandConnection,
  onExpandDatabase,
  onExpandTable,
  onPreviewTable,
  onSelectConnection,
}: ConnectionTreeViewProps) {
  const [expandedConnections, setExpandedConnections] = useState<Set<string>>(new Set());
  const [expandedDatabases, setExpandedDatabases] = useState<Set<string>>(new Set());
  const [expandedTables, setExpandedTables] = useState<Set<string>>(new Set());

  function handleToggleConnection(connId: string) {
    setExpandedConnections((prev) => {
      const next = new Set(prev);
      if (next.has(connId)) {
        next.delete(connId);
      } else {
        next.add(connId);
        onExpandConnection(connId);
        onSelectConnection(connId);
      }
      return next;
    });
  }

  function handleToggleDatabase(connId: string, dbName: string) {
    const key = `${connId}.${dbName}`;
    setExpandedDatabases((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
        onExpandDatabase(connId, dbName);
      }
      return next;
    });
  }

  function handleToggleTable(connId: string, dbName: string, tableName: string) {
    const key = `${connId}.${dbName}.${tableName}`;
    setExpandedTables((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
        onExpandTable(connId, dbName, tableName);
      }
      return next;
    });
  }

  const query = searchQuery.toLowerCase().trim();

  return (
    <div className="text-sm" role="tree">
      <ul className="space-y-0.5" role="group">
        {connections.map((conn) => {
          const isConnExpanded = expandedConnections.has(conn.id);
          const isConnLoading = treeLoading[conn.id] ?? false;
          const isActive = activeConnectionId === conn.id;
          const allDbs = connectionDatabases[conn.id] ?? [];
          const connLabel = conn.label || `${conn.host}:${conn.port}`;

          // Filter databases and tables by search query
          let dbs = allDbs;
          if (query) {
            dbs = allDbs.filter((dbName) => {
              // Match database name
              if (dbName.toLowerCase().includes(query)) return true;
              // Match any table in this database
              const dbKey = `${conn.id}.${dbName}`;
              const dbTables = tables[dbKey] ?? [];
              return dbTables.some((t) => t.toLowerCase().includes(query));
            });
            // If no databases match and connection label doesn't match, hide this connection
            if (dbs.length === 0 && !connLabel.toLowerCase().includes(query)) {
              return null;
            }
          }

          return (
            <li key={conn.id} role="treeitem" aria-expanded={isConnExpanded}>
              {/* Connection node */}
              <button
                type="button"
                onClick={() => handleToggleConnection(conn.id)}
                className={`w-full flex items-center gap-1.5 px-2 py-1.5 rounded transition-colors text-left ${
                  isActive
                    ? 'bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-700'
                    : 'hover:bg-gray-100 dark:hover:bg-gray-700'
                }`}
              >
                <span className="text-[10px] text-gray-400 dark:text-gray-500 w-3 flex-shrink-0">
                  {isConnExpanded ? '▼' : '▶'}
                </span>
                <span className="flex-shrink-0">🔌</span>
                <span className="text-gray-900 dark:text-gray-100 truncate font-medium text-xs">
                  {connLabel}
                </span>
                <span className="text-[10px] px-1 py-0.5 bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 rounded flex-shrink-0 ml-auto">
                  {conn.dbType.toUpperCase()}
                </span>
                {isConnLoading && (
                  <span className="flex-shrink-0">
                    <LoadingSpinner />
                  </span>
                )}
              </button>

              {/* Databases list */}
              {isConnExpanded && (
                <ul className="ml-4 mt-0.5 space-y-0.5" role="group">
                  {dbs.length === 0 && !isConnLoading && (
                    <li className="px-2 py-1 text-xs text-gray-400 dark:text-gray-500 italic">
                      No databases found
                    </li>
                  )}
                  {dbs.map((dbName) => {
                    const dbKey = `${conn.id}.${dbName}`;
                    const isDbExpanded = expandedDatabases.has(dbKey);
                    const isDbLoading = treeLoading[dbKey] ?? false;
                    const isDbAccessDenied = accessDenied.includes(dbKey);
                    const allDbTables = tables[dbKey] ?? [];
                    // Filter tables by search query
                    const dbTables = query
                      ? allDbTables.filter((t) => t.toLowerCase().includes(query) || dbName.toLowerCase().includes(query))
                      : allDbTables;

                    return (
                      <li key={dbKey} role="treeitem" aria-expanded={isDbExpanded}>
                        {/* Database node */}
                        <button
                          type="button"
                          onClick={() => handleToggleDatabase(conn.id, dbName)}
                          disabled={isDbAccessDenied}
                          className="w-full flex items-center gap-1.5 px-2 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors text-left"
                        >
                          {!isDbAccessDenied && (
                            <span className="text-[10px] text-gray-400 dark:text-gray-500 w-3 flex-shrink-0">
                              {isDbExpanded ? '▼' : '▶'}
                            </span>
                          )}
                          {isDbAccessDenied && (
                            <span className="text-[10px] w-3 flex-shrink-0">🔒</span>
                          )}
                          <span className="flex-shrink-0">
                            {isDbExpanded ? '📂' : '📁'}
                          </span>
                          <span className={`truncate ${isDbAccessDenied ? 'text-gray-400 dark:text-gray-500' : 'text-gray-900 dark:text-gray-100'}`}>
                            {dbName}
                          </span>
                          {isDbAccessDenied && (
                            <span className="ml-auto text-xs text-red-500 dark:text-red-400 flex-shrink-0">
                              Access denied
                            </span>
                          )}
                          {isDbLoading && (
                            <span className="ml-auto flex-shrink-0"><LoadingSpinner /></span>
                          )}
                        </button>

                        {/* Tables list */}
                        {isDbExpanded && !isDbAccessDenied && (
                          <ul className="ml-4 mt-0.5 space-y-0.5" role="group">
                            {dbTables.length === 0 && !isDbLoading && (
                              <li className="px-2 py-1 text-xs text-gray-400 dark:text-gray-500 italic">
                                No tables found
                              </li>
                            )}
                            {dbTables.map((tableName) => {
                              const tableKey = `${conn.id}.${dbName}.${tableName}`;
                              const isTableExpanded = expandedTables.has(tableKey);
                              const isTableLoading = treeLoading[tableKey] ?? false;
                              const columns = tableStructure[tableKey] ?? [];

                              return (
                                <li key={tableKey} role="treeitem" aria-expanded={isTableExpanded}>
                                  {/* Table node */}
                                  <button
                                    type="button"
                                    onClick={() => handleToggleTable(conn.id, dbName, tableName)}
                                    onDoubleClick={(e) => {
                                      e.preventDefault();
                                      onPreviewTable(conn.id, dbName, tableName);
                                    }}
                                    onContextMenu={(e) => {
                                      e.preventDefault();
                                      onPreviewTable(conn.id, dbName, tableName);
                                    }}
                                    className="w-full flex items-center gap-1.5 px-2 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors text-left"
                                  >
                                    <span className="text-[10px] text-gray-400 dark:text-gray-500 w-3 flex-shrink-0">
                                      {isTableExpanded ? '▼' : '▶'}
                                    </span>
                                    <span className="flex-shrink-0">
                                      {isTableExpanded ? '📋' : '📄'}
                                    </span>
                                    <span className="text-gray-900 dark:text-gray-100 truncate">
                                      {tableName}
                                    </span>
                                    {isTableLoading && (
                                      <span className="ml-auto flex-shrink-0"><LoadingSpinner /></span>
                                    )}
                                  </button>

                                  {/* Columns list */}
                                  {isTableExpanded && (
                                    <ul className="ml-4 mt-0.5 space-y-0.5" role="group">
                                      {columns.length === 0 && !isTableLoading && (
                                        <li className="px-2 py-0.5 text-xs text-gray-400 dark:text-gray-500 italic">
                                          No columns found
                                        </li>
                                      )}
                                      {columns.map((col) => (
                                        <li
                                          key={`${tableKey}.${col.name}`}
                                          className="flex items-center gap-1.5 px-2 py-0.5 text-xs"
                                          role="treeitem"
                                        >
                                          <span className="flex-shrink-0">
                                            {col.primaryKey ? '🔑' : '🔹'}
                                          </span>
                                          <span className="font-medium text-gray-800 dark:text-gray-200">
                                            {col.name}
                                          </span>
                                          <span className="text-gray-500 dark:text-gray-400">
                                            {col.type}
                                          </span>
                                          {col.nullable && (
                                            <span className="text-gray-400 dark:text-gray-500 text-[10px]">
                                              NULL
                                            </span>
                                          )}
                                          {!col.nullable && (
                                            <span className="text-orange-500 dark:text-orange-400 text-[10px]">
                                              NOT NULL
                                            </span>
                                          )}
                                        </li>
                                      ))}
                                    </ul>
                                  )}
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Reusable loading spinner */
function LoadingSpinner() {
  return (
    <svg
      className="animate-spin h-4 w-4 text-gray-400 dark:text-gray-500"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      aria-hidden="true"
      data-testid="loading-spinner"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );
}
