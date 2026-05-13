'use client';

import { useCallback } from 'react';
import QueryResults from './QueryResults';
import type { QueryResult } from './query-results-utils';

export interface TableTab {
  id: string; // unique key: connId.dbName.tableName or query.N
  connId: string;
  dbName: string;
  tableName: string;
  result: QueryResult | null;
  error: string | null;
  isLoading: boolean;
}

export interface TableTabsProps {
  tabs: TableTab[];
  activeTabId: string | null;
  onSelectTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onRefreshTab: (tab: TableTab) => void;
  onExport: (tab: TableTab) => void;
  onCopyQuery?: (sql: string) => void;
  onExecuteUpdate?: (sql: string) => void;
}

export default function TableTabs({
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  onRefreshTab,
  onExport,
  onCopyQuery,
  onExecuteUpdate,
}: TableTabsProps) {
  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null;

  const handleExport = useCallback(() => {
    if (activeTab) {
      onExport(activeTab);
    }
  }, [activeTab, onExport]);

  if (tabs.length === 0) {
    return (
      <div
        data-testid="table-tabs-empty"
        className="flex items-center justify-center h-[150px] text-gray-500 dark:text-gray-400 border border-gray-300 dark:border-gray-600 rounded-lg"
      >
        <p className="text-sm">Double-click a table to view its data here.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0" data-testid="table-tabs">
      {/* Tab bar */}
      <div className="flex items-center border-b border-gray-200 dark:border-gray-700 overflow-x-auto flex-shrink-0 bg-gray-50 dark:bg-gray-800 rounded-t-lg">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          return (
            <div
              key={tab.id}
              className={`group flex items-center gap-1 px-3 py-2 text-xs font-medium border-b-2 cursor-pointer select-none whitespace-nowrap transition-colors ${
                isActive
                  ? 'border-blue-600 text-blue-600 dark:text-blue-400 dark:border-blue-400 bg-white dark:bg-gray-900'
                  : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
              }`}
              onClick={() => onSelectTab(tab.id)}
              title={`${tab.dbName}.${tab.tableName}`}
              data-testid={`table-tab-${tab.id}`}
            >
              <span className="flex-shrink-0">📄</span>
              <span className="max-w-[120px] truncate">{tab.tableName}</span>
              <span className="text-[10px] text-gray-400 dark:text-gray-500 ml-0.5">
                ({tab.dbName})
              </span>
              {tab.isLoading && (
                <svg
                  className="animate-spin h-3 w-3 text-gray-400 ml-1 flex-shrink-0"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
              )}
              {/* Close button */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onCloseTab(tab.id);
                }}
                className="ml-1 p-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-600 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                aria-label={`Close ${tab.tableName}`}
                data-testid={`close-tab-${tab.id}`}
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          );
        })}

        {/* Refresh button for active tab */}
        {activeTab && (
          <button
            type="button"
            onClick={() => onRefreshTab(activeTab)}
            className="ml-auto mr-2 p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-500 dark:text-gray-400 transition-colors flex-shrink-0"
            aria-label="Refresh table data"
            title="Refresh"
            data-testid="refresh-tab-btn"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        )}
      </div>

      {/* Active tab content */}
      <div className="flex-1 overflow-auto min-h-0">
        {activeTab && (
          <div className="h-full overflow-auto">
            <QueryResults
              result={activeTab.result}
              error={activeTab.error}
              isLoading={activeTab.isLoading}
              onExport={handleExport}
              onCopyQuery={onCopyQuery}
              onExecuteUpdate={onExecuteUpdate}
              tableName={activeTab.dbName !== 'Query' ? `\`${activeTab.dbName}\`.\`${activeTab.tableName}\`` : undefined}
            />
          </div>
        )}
      </div>
    </div>
  );
}
