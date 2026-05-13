'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';
import dynamic from 'next/dynamic';
import ConnectionList from '@/components/db/ConnectionList';
import QueryHistory from '@/components/db/QueryHistory';
import ConnectionForm from '@/components/db/ConnectionForm';
import TableTabs from '@/components/db/TableTabs';
import type { TableTab } from '@/components/db/TableTabs';
import type { ConnectionItem } from '@/components/db/ConnectionList';
import type { ColumnInfo } from '@/components/db/database-tree-utils';
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
  const [queryTabCounter, setQueryTabCounter] = useState(0);

  // History state
  const [queryHistory, setQueryHistory] = useState<QueryHistoryEntry[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);

  // UI state
  const [activePanel, setActivePanel] = useState<MainPanel>('results');
  const [treeSearchQuery, setTreeSearchQuery] = useState('');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // Table tabs state
  const [tableTabs, setTableTabs] = useState<TableTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);

  // Confirmation modal state
  const [confirmQuery, setConfirmQuery] = useState<{ sql: string; selectedText?: string } | null>(null);

  // Table action picker state
  const [tableActionPicker, setTableActionPicker] = useState<{ connId: string; dbName: string; tableName: string } | null>(null);

  // Error state
  const [apiError, setApiError] = useState<string | null>(null);

  // Build schema for SQL autocomplete from loaded table structures
  const editorSchema = useMemo(() => {
    const schema: Record<string, Record<string, readonly string[]>> = {};

    // Build from tableStructure: key = "connId.dbName.tableName"
    for (const [key, columns] of Object.entries(tableStructure)) {
      // Find the connId by checking which connection this belongs to
      const colNames = columns.map((col) => col.name);

      for (const connId of Object.keys(connectionDatabases)) {
        if (key.startsWith(`${connId}.`)) {
          const rest = key.slice(connId.length + 1); // "dbName.tableName"
          const dotIdx = rest.indexOf('.');
          if (dotIdx !== -1) {
            const dbName = rest.slice(0, dotIdx);
            const tableName = rest.slice(dotIdx + 1);

            if (!schema[dbName]) schema[dbName] = {};
            schema[dbName][tableName] = colNames;
          }
          break;
        }
      }
    }

    // Add tables without columns from tables state: key = "connId.dbName"
    for (const [key, tableList] of Object.entries(tables)) {
      for (const connId of Object.keys(connectionDatabases)) {
        if (key.startsWith(`${connId}.`)) {
          const dbName = key.slice(connId.length + 1);
          if (!schema[dbName]) schema[dbName] = {};
          for (const tableName of tableList) {
            if (!schema[dbName][tableName]) {
              schema[dbName][tableName] = [];
            }
          }
          break;
        }
      }
    }

    return schema;
  }, [tableStructure, tables, connectionDatabases]);

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
    const tabId = `${connId}.${dbName}.${tableName}`;

    // If tab already exists, just switch to it
    const existingTab = tableTabs.find((t) => t.id === tabId);
    if (existingTab) {
      setActiveTabId(tabId);
      setActivePanel('results');
      return;
    }

    // Show action picker
    setTableActionPicker({ connId, dbName, tableName });
  }, [tableTabs]);

  const handleViewTableData = useCallback(async () => {
    if (!tableActionPicker) return;
    const { connId, dbName, tableName } = tableActionPicker;
    setTableActionPicker(null);

    const tabId = `${connId}.${dbName}.${tableName}`;
    const newTab: TableTab = {
      id: tabId,
      connId,
      dbName,
      tableName,
      result: null,
      error: null,
      isLoading: true,
    };

    setTableTabs((prev) => [...prev, newTab]);
    setActiveTabId(tabId);
    setActivePanel('results');
    setActiveConnectionId(connId);

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
      setTableTabs((prev) =>
        prev.map((t) => (t.id === tabId ? { ...t, result, isLoading: false } : t))
      );
    } catch (err: any) {
      setTableTabs((prev) =>
        prev.map((t) =>
          t.id === tabId ? { ...t, error: err.message || 'Query execution failed', isLoading: false } : t
        )
      );
    } finally {
      fetchHistory();
    }
  }, [tableActionPicker, fetchHistory]);

  // DDL modal state
  const [ddlContent, setDdlContent] = useState<{ tableName: string; ddl: string } | null>(null);
  const [ddlLoading, setDdlLoading] = useState(false);

  const handleViewTableDDL = useCallback(async () => {
    if (!tableActionPicker) return;
    const { connId, dbName, tableName } = tableActionPicker;
    setTableActionPicker(null);
    setDdlLoading(true);
    setDdlContent({ tableName: `${dbName}.${tableName}`, ddl: '' });

    const sql = `SHOW CREATE TABLE \`${dbName}\`.\`${tableName}\``;

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
      // SHOW CREATE TABLE returns a row with "Create Table" column
      let ddlText = '';
      if (result.rows && result.rows.length > 0) {
        const row = result.rows[0];
        ddlText = row['Create Table'] || row['Create View'] || JSON.stringify(row, null, 2);
      }
      setDdlContent({ tableName: `${dbName}.${tableName}`, ddl: ddlText });
    } catch (err: any) {
      setDdlContent({ tableName: `${dbName}.${tableName}`, ddl: `-- Error: ${err.message}` });
    } finally {
      setDdlLoading(false);
    }
  }, [tableActionPicker]);

  const handleCopyDDL = useCallback(() => {
    if (ddlContent?.ddl) {
      navigator.clipboard.writeText(ddlContent.ddl);
    }
  }, [ddlContent]);

  const handleRefreshTab = useCallback(async (tab: TableTab) => {
    const { id: tabId, connId, dbName, tableName } = tab;

    setTableTabs((prev) =>
      prev.map((t) => (t.id === tabId ? { ...t, isLoading: true, error: null } : t))
    );

    const sql = `SELECT * FROM \`${dbName}\`.\`${tableName}\` LIMIT 300`;

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
      setTableTabs((prev) =>
        prev.map((t) => (t.id === tabId ? { ...t, result, error: null, isLoading: false } : t))
      );
    } catch (err: any) {
      setTableTabs((prev) =>
        prev.map((t) =>
          t.id === tabId ? { ...t, error: err.message || 'Query execution failed', isLoading: false } : t
        )
      );
    }
  }, []);

  const handleCloseTab = useCallback((tabId: string) => {
    setTableTabs((prev) => {
      const newTabs = prev.filter((t) => t.id !== tabId);
      // If we closed the active tab, switch to the last remaining tab or null
      if (activeTabId === tabId) {
        const lastTab = newTabs[newTabs.length - 1];
        setActiveTabId(lastTab ? lastTab.id : null);
      }
      return newTabs;
    });
  }, [activeTabId]);

  const handleExportTab = useCallback(async (tab: TableTab) => {
    if (!tab.result) return;
    try {
      const res = await fetch(`/api/databases/${tab.connId}/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          columns: tab.result.columns,
          rows: tab.result.rows,
          database: tab.dbName,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Export failed');
      }

      const disposition = res.headers.get('Content-Disposition');
      let filename = 'export.csv';
      if (disposition) {
        const match = disposition.match(/filename="?([^"]+)"?/);
        if (match) {
          filename = match[1];
        }
      }

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
  }, []);

  const handleRunQuery = useCallback(async (selectedText?: string) => {
    // If selectedText is empty string, it means nothing was selected — show warning
    if (selectedText !== undefined && selectedText.trim() === '') {
      // Create an error tab for the warning
      const counter = queryTabCounter + 1;
      setQueryTabCounter(counter);
      const tabId = `query.${counter}`;
      const newTab: TableTab = {
        id: tabId,
        connId: activeConnectionId || '',
        dbName: 'Query',
        tableName: `Result #${counter}`,
        result: null,
        error: 'Blok/select query yang ingin dijalankan terlebih dahulu',
        isLoading: false,
      };
      setTableTabs((prev) => [...prev, newTab]);
      setActiveTabId(tabId);
      setActivePanel('results');
      return;
    }

    const queryToRun = selectedText ? selectedText.trim() : sqlValue.trim();
    if (!queryToRun || !activeConnectionId) return;

    // Check if query is a dangerous mutation (INSERT, UPDATE, DELETE)
    const upperQuery = queryToRun.toUpperCase().trimStart();
    const isDangerous = upperQuery.startsWith('INSERT') || upperQuery.startsWith('UPDATE') || upperQuery.startsWith('DELETE') || upperQuery.startsWith('DROP') || upperQuery.startsWith('ALTER') || upperQuery.startsWith('TRUNCATE');

    if (isDangerous) {
      setConfirmQuery({ sql: queryToRun, selectedText });
      return;
    }

    await executeQuery(queryToRun);
  }, [sqlValue, activeConnectionId, queryTabCounter]);

  // Actually execute the query (called directly or after confirmation)
  const executeQuery = useCallback(async (queryToRun: string) => {
    if (!activeConnectionId) return;

    const counter = queryTabCounter + 1;
    setQueryTabCounter(counter);
    const tabId = `query.${counter}`;

    // Create a new tab for this query result
    const queryLabel = queryToRun.length > 30 ? queryToRun.substring(0, 30) + '...' : queryToRun;
    const newTab: TableTab = {
      id: tabId,
      connId: activeConnectionId,
      dbName: 'Query',
      tableName: queryLabel,
      result: null,
      error: null,
      isLoading: true,
    };

    setTableTabs((prev) => [...prev, newTab]);
    setActiveTabId(tabId);
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
      setTableTabs((prev) =>
        prev.map((t) => (t.id === tabId ? { ...t, result, isLoading: false } : t))
      );
    } catch (err: any) {
      setTableTabs((prev) =>
        prev.map((t) =>
          t.id === tabId ? { ...t, error: err.message || 'Query execution failed', isLoading: false } : t
        )
      );
    } finally {
      // Auto-refresh history after each execution
      fetchHistory();
    }
  }, [activeConnectionId, fetchHistory, queryTabCounter]);

  // Handle confirmation: execute the dangerous query
  const handleConfirmExecute = useCallback(() => {
    if (confirmQuery) {
      executeQuery(confirmQuery.sql);
      setConfirmQuery(null);
    }
  }, [confirmQuery, executeQuery]);

  const handleCancelExecute = useCallback(() => {
    setConfirmQuery(null);
  }, []);

  // History click fills editor
  const handleSelectHistoryQuery = useCallback((queryText: string) => {
    setSqlValue(queryText);
  }, []);

  // Execute an inline edit UPDATE directly (already confirmed in the cell edit modal)
  const handleExecuteUpdate = useCallback(async (sql: string) => {
    if (!activeConnectionId) return;
    setSqlValue(sql);
    await executeQuery(sql);
  }, [activeConnectionId, executeQuery]);

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
        {/* Sidebar toggle button (visible when collapsed) */}
        {sidebarCollapsed && (
          <button
            type="button"
            onClick={() => setSidebarCollapsed(false)}
            className="flex-shrink-0 flex flex-col items-center justify-start pt-3 w-8 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            aria-label="Open sidebar"
            title="Open sidebar"
          >
            <svg className="w-4 h-4 text-gray-500 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            <span className="mt-2 text-[10px] text-gray-500 dark:text-gray-400 writing-mode-vertical" style={{ writingMode: 'vertical-rl' }}>
              Explorer
            </span>
          </button>
        )}

        {/* Left sidebar */}
        {!sidebarCollapsed && (
          <aside className="w-[300px] flex-shrink-0 flex flex-col gap-4 min-h-0 overflow-hidden">
            {/* Collapse button */}
            <div className="flex items-center justify-between flex-shrink-0">
              <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                Explorer
              </span>
              <button
                type="button"
                onClick={() => setSidebarCollapsed(true)}
                className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-500 dark:text-gray-400 transition-colors"
                aria-label="Close sidebar"
                title="Close sidebar"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
            </div>

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
        )}

        {/* Main content area */}
        <div className="flex-1 flex flex-col gap-2 min-w-0 min-h-0">
          {/* SQL Editor */}
          <div className="flex-shrink-0">
            <SQLEditor
              value={sqlValue}
              onChange={setSqlValue}
              onRun={handleRunQuery}
              disabled={!activeConnectionId}
              schema={editorSchema}
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
                {tableTabs.length > 0 && (
                  <span className="ml-1.5 px-1.5 py-0.5 text-[10px] bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 rounded-full">
                    {tableTabs.length}
                  </span>
                )}
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
            <div className="flex-1 overflow-auto min-h-0">
              {activePanel === 'results' && (
                <TableTabs
                  tabs={tableTabs}
                  activeTabId={activeTabId}
                  onSelectTab={setActiveTabId}
                  onCloseTab={handleCloseTab}
                  onRefreshTab={handleRefreshTab}
                  onExport={handleExportTab}
                  onCopyQuery={setSqlValue}
                  onExecuteUpdate={handleExecuteUpdate}
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

      {/* Table Action Picker Modal */}
      {tableActionPicker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-black/60"
            onClick={() => setTableActionPicker(null)}
            aria-hidden="true"
          />
          <div className="relative w-full max-w-xs bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl p-5">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-1">
              {tableActionPicker.tableName}
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
              {tableActionPicker.dbName}
            </p>
            <div className="space-y-2">
              <button
                type="button"
                onClick={handleViewTableData}
                className="w-full flex items-center gap-3 px-4 py-3 text-sm text-left rounded-md hover:bg-blue-50 dark:hover:bg-blue-900/20 border border-gray-200 dark:border-gray-700 transition-colors"
              >
                <span className="text-lg">📊</span>
                <div>
                  <div className="font-medium text-gray-900 dark:text-gray-100">View Data</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">SELECT * FROM table LIMIT 300</div>
                </div>
              </button>
              <button
                type="button"
                onClick={handleViewTableDDL}
                className="w-full flex items-center gap-3 px-4 py-3 text-sm text-left rounded-md hover:bg-green-50 dark:hover:bg-green-900/20 border border-gray-200 dark:border-gray-700 transition-colors"
              >
                <span className="text-lg">🏗️</span>
                <div>
                  <div className="font-medium text-gray-900 dark:text-gray-100">View DDL</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">SHOW CREATE TABLE</div>
                </div>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DDL Popup Modal */}
      {ddlContent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-black/60"
            onClick={() => setDdlContent(null)}
            aria-hidden="true"
          />
          <div className="relative w-full max-w-2xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl flex flex-col max-h-[80vh]">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
              <div>
                <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                  DDL — {ddlContent.tableName}
                </h3>
                <p className="text-xs text-gray-500 dark:text-gray-400">CREATE TABLE statement</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleCopyDDL}
                  disabled={ddlLoading || !ddlContent.ddl}
                  className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 rounded transition-colors"
                >
                  Copy DDL
                </button>
                <button
                  type="button"
                  onClick={() => setDdlContent(null)}
                  className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-500 dark:text-gray-400"
                  aria-label="Close"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
            {/* Content */}
            <div className="flex-1 overflow-auto p-5">
              {ddlLoading ? (
                <div className="flex items-center justify-center py-8">
                  <svg className="animate-spin h-5 w-5 text-gray-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  <span className="ml-2 text-sm text-gray-500 dark:text-gray-400">Loading DDL...</span>
                </div>
              ) : (
                <pre className="text-xs font-mono text-gray-800 dark:text-gray-200 whitespace-pre-wrap bg-gray-50 dark:bg-gray-900 p-4 rounded-md border border-gray-200 dark:border-gray-700 overflow-auto">
                  {ddlContent.ddl}
                </pre>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Dangerous Query Confirmation Modal */}
      {confirmQuery && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-black/60"
            onClick={handleCancelExecute}
            aria-hidden="true"
          />
          <div className="relative w-full max-w-md bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="flex-shrink-0 w-10 h-10 flex items-center justify-center rounded-full bg-orange-100 dark:bg-orange-900/30">
                <svg className="w-5 h-5 text-orange-600 dark:text-orange-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
              </div>
              <div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                  Confirm Execution
                </h3>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  This query will modify data in the database.
                </p>
              </div>
            </div>
            <div className="mb-4 p-3 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-md overflow-auto max-h-[150px]">
              <pre className="text-xs text-gray-800 dark:text-gray-200 font-mono whitespace-pre-wrap break-all">
                {confirmQuery.sql}
              </pre>
            </div>
            <p className="text-sm text-orange-700 dark:text-orange-300 mb-4">
              ⚠️ Are you sure you want to execute this query? This action may not be reversible.
            </p>
            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={handleCancelExecute}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-md transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmExecute}
                className="px-4 py-2 text-sm font-medium text-white bg-orange-600 hover:bg-orange-700 rounded-md transition-colors"
              >
                Execute
              </button>
            </div>
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
