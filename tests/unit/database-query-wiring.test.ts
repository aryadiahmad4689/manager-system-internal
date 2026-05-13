import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Tests for task 13.2: Wire query execution flow.
 * Verifies that the database page correctly wires:
 * - SQLEditor "Run" action to POST /api/databases/[id]/query
 * - Display results in QueryResults component
 * - Auto-refresh QueryHistory after each execution
 * - History click to populate SQLEditor
 * - Export CSV button to POST /api/databases/[id]/export with file download
 */

describe('DatabaseManagementPage - Query execution wiring (task 13.2)', () => {
  const pagePath = resolve(__dirname, '../../src/app/(dashboard)/databases/page.tsx');
  const pageContent = readFileSync(pagePath, 'utf-8');

  describe('Run query - POST /api/databases/[id]/query', () => {
    it('should have an async handleRunQuery function', () => {
      expect(pageContent).toContain('const handleRunQuery = useCallback(async');
    });

    it('should POST to /api/databases/[id]/query with SQL body', () => {
      expect(pageContent).toContain('`/api/databases/${activeConnectionId}/query`');
      expect(pageContent).toContain("method: 'POST'");
      expect(pageContent).toContain('body: JSON.stringify({ sql: queryToRun })');
    });

    it('should not execute if SQL is empty', () => {
      expect(pageContent).toContain("if (!queryToRun || !activeConnectionId) return");
    });

    it('should set loading state during execution via tab', () => {
      expect(pageContent).toContain('isLoading: true');
      expect(pageContent).toContain('isLoading: false');
    });

    it('should create a new tab for query results', () => {
      expect(pageContent).toContain('setTableTabs((prev) => [...prev, newTab])');
      expect(pageContent).toContain('setActiveTabId(tabId)');
    });

    it('should switch to results panel on execution', () => {
      expect(pageContent).toContain("setActivePanel('results')");
    });

    it('should set query result on success via tab update', () => {
      expect(pageContent).toContain('{ ...t, result, isLoading: false }');
    });

    it('should set query error on failure via tab update', () => {
      expect(pageContent).toContain("err.message || 'Query execution failed'");
    });
  });

  describe('Auto-refresh QueryHistory after execution', () => {
    it('should have a fetchHistory function', () => {
      expect(pageContent).toContain('const fetchHistory = useCallback(async ()');
    });

    it('should fetch history from GET /api/databases/[id]/history', () => {
      expect(pageContent).toContain('`/api/databases/${activeConnectionId}/history`');
    });

    it('should call fetchHistory after query execution (in finally block)', () => {
      // The fetchHistory call should be in the finally block of handleRunQuery
      expect(pageContent).toContain('// Auto-refresh history after each execution');
      expect(pageContent).toContain('fetchHistory()');
    });

    it('should set history loading state', () => {
      expect(pageContent).toContain('setIsLoadingHistory(true)');
      expect(pageContent).toContain('setIsLoadingHistory(false)');
    });

    it('should update queryHistory state with fetched data', () => {
      expect(pageContent).toContain('setQueryHistory(data)');
    });

    it('should load history when active connection changes', () => {
      // useEffect that depends on activeConnectionId
      expect(pageContent).toContain('[activeConnectionId, fetchHistory]');
    });

    it('should clear history when no connection is active', () => {
      expect(pageContent).toContain('setQueryHistory([])');
    });
  });

  describe('History click populates SQLEditor', () => {
    it('should have handleSelectHistoryQuery that sets SQL value', () => {
      expect(pageContent).toContain('const handleSelectHistoryQuery = useCallback((queryText: string)');
      expect(pageContent).toContain('setSqlValue(queryText)');
    });

    it('should pass handleSelectHistoryQuery to QueryHistory component', () => {
      expect(pageContent).toContain('onSelectQuery={handleSelectHistoryQuery}');
    });
  });

  describe('Export CSV - POST /api/databases/[id]/export', () => {
    it('should have an async handleExportTab function', () => {
      expect(pageContent).toContain('const handleExportTab = useCallback(async (tab: TableTab)');
    });

    it('should POST to /api/databases/[connId]/export', () => {
      expect(pageContent).toContain('`/api/databases/${tab.connId}/export`');
    });

    it('should send columns and rows from tab result', () => {
      expect(pageContent).toContain('columns: tab.result.columns');
      expect(pageContent).toContain('rows: tab.result.rows');
    });

    it('should not export if no tab result', () => {
      expect(pageContent).toContain('if (!tab.result) return');
    });

    it('should extract filename from Content-Disposition header', () => {
      expect(pageContent).toContain("res.headers.get('Content-Disposition')");
      expect(pageContent).toContain('filename');
    });

    it('should trigger file download via blob URL', () => {
      expect(pageContent).toContain('res.blob()');
      expect(pageContent).toContain('window.URL.createObjectURL(blob)');
      expect(pageContent).toContain('a.download = filename');
      expect(pageContent).toContain('a.click()');
    });

    it('should clean up blob URL after download', () => {
      expect(pageContent).toContain('window.URL.revokeObjectURL(url)');
    });

    it('should handle export errors', () => {
      expect(pageContent).toContain("setApiError(err.message || 'Export failed')");
    });

    it('should pass handleExportTab to TableTabs component', () => {
      expect(pageContent).toContain('onExport={handleExportTab}');
    });
  });

  describe('Component integration', () => {
    it('should pass sqlValue and setSqlValue to SQLEditor', () => {
      expect(pageContent).toContain('value={sqlValue}');
      expect(pageContent).toContain('onChange={setSqlValue}');
    });

    it('should pass handleRunQuery to SQLEditor onRun', () => {
      expect(pageContent).toContain('onRun={handleRunQuery}');
    });

    it('should disable SQLEditor when no connection is active', () => {
      expect(pageContent).toContain('disabled={!activeConnectionId}');
    });

    it('should pass tabs and handlers to TableTabs', () => {
      expect(pageContent).toContain('tabs={tableTabs}');
      expect(pageContent).toContain('activeTabId={activeTabId}');
      expect(pageContent).toContain('onCloseTab={handleCloseTab}');
      expect(pageContent).toContain('onRefreshTab={handleRefreshTab}');
    });

    it('should pass history entries to QueryHistory', () => {
      expect(pageContent).toContain('entries={queryHistory}');
      expect(pageContent).toContain('isLoading={isLoadingHistory}');
    });
  });
});
