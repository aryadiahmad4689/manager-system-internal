'use client';

import { useState } from 'react';
import {
  getTableNodeKey,
  formatColumnType,
  isDatabaseAccessDenied,
  getChevron,
} from './database-tree-utils';
import type { ColumnInfo } from './database-tree-utils';

export type { ColumnInfo };

export interface DatabaseTreeViewProps {
  databases: string[];
  tables: Record<string, string[]>;
  tableStructure: Record<string, ColumnInfo[]>;
  accessDenied: string[];
  onExpandDatabase: (dbName: string) => void;
  onExpandTable: (dbName: string, tableName: string) => void;
  onPreviewTable?: (dbName: string, tableName: string) => void;
  isLoading?: Record<string, boolean>;
}

export default function DatabaseTreeView({
  databases,
  tables,
  tableStructure,
  accessDenied,
  onExpandDatabase,
  onExpandTable,
  onPreviewTable,
  isLoading = {},
}: DatabaseTreeViewProps) {
  const [expandedDatabases, setExpandedDatabases] = useState<Set<string>>(new Set());
  const [expandedTables, setExpandedTables] = useState<Set<string>>(new Set());

  function handleToggleDatabase(dbName: string) {
    setExpandedDatabases((prev) => {
      const next = new Set(prev);
      if (next.has(dbName)) {
        next.delete(dbName);
      } else {
        next.add(dbName);
        onExpandDatabase(dbName);
      }
      return next;
    });
  }

  function handleToggleTable(dbName: string, tableName: string) {
    const key = getTableNodeKey(dbName, tableName);
    setExpandedTables((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
        onExpandTable(dbName, tableName);
      }
      return next;
    });
  }

  if (databases.length === 0) {
    return (
      <div
        data-testid="tree-empty"
        className="text-center py-6 text-gray-500 dark:text-gray-400"
      >
        <svg
          className="mx-auto h-10 w-10 text-gray-400 dark:text-gray-500 mb-2"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4"
          />
        </svg>
        <p className="text-sm">No databases available.</p>
        <p className="text-xs mt-1">Connect to a server to browse databases.</p>
      </div>
    );
  }

  return (
    <div data-testid="database-tree" className="text-sm" role="tree">
      <ul className="space-y-0.5" role="group">
        {databases.map((dbName) => {
          const isAccessDenied = isDatabaseAccessDenied(dbName, accessDenied);
          const isExpanded = expandedDatabases.has(dbName);
          const isDbLoading = isLoading[dbName] ?? false;
          const dbTables = tables[dbName] ?? [];

          return (
            <li key={dbName} role="treeitem" aria-expanded={isExpanded}>
              {/* Database node */}
              <button
                type="button"
                onClick={() => handleToggleDatabase(dbName)}
                data-testid={`db-node-${dbName}`}
                className="w-full flex items-center gap-1.5 px-2 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors text-left"
                aria-label={`Database: ${dbName}${isAccessDenied ? ' (Access denied)' : ''}`}
                disabled={isAccessDenied}
              >
                {!isAccessDenied && (
                  <span className="text-[10px] text-gray-400 dark:text-gray-500 w-3 flex-shrink-0">
                    {getChevron(isExpanded)}
                  </span>
                )}
                {isAccessDenied && (
                  <span className="text-[10px] text-gray-400 dark:text-gray-500 w-3 flex-shrink-0">
                    🔒
                  </span>
                )}
                <span className="flex-shrink-0">
                  {isExpanded ? '📂' : '📁'}
                </span>
                <span className={`truncate ${isAccessDenied ? 'text-gray-400 dark:text-gray-500' : 'text-gray-900 dark:text-gray-100'}`}>
                  {dbName}
                </span>
                {isAccessDenied && (
                  <span
                    data-testid={`access-denied-${dbName}`}
                    className="ml-auto text-xs text-red-500 dark:text-red-400 flex-shrink-0"
                  >
                    Access denied
                  </span>
                )}
                {isDbLoading && (
                  <span className="ml-auto flex-shrink-0">
                    <LoadingSpinner />
                  </span>
                )}
              </button>

              {/* Tables list */}
              {isExpanded && !isAccessDenied && (
                <ul className="ml-4 mt-0.5 space-y-0.5" role="group">
                  {dbTables.length === 0 && !isDbLoading && (
                    <li className="px-2 py-1 text-xs text-gray-400 dark:text-gray-500 italic">
                      No tables found
                    </li>
                  )}
                  {dbTables.map((tableName) => {
                    const tableKey = getTableNodeKey(dbName, tableName);
                    const isTableExpanded = expandedTables.has(tableKey);
                    const isTableLoading = isLoading[tableKey] ?? false;
                    const columns = tableStructure[tableKey] ?? [];

                    return (
                      <li key={tableKey} role="treeitem" aria-expanded={isTableExpanded}>
                        {/* Table node */}
                        <button
                          type="button"
                          onClick={() => handleToggleTable(dbName, tableName)}
                          onDoubleClick={(e) => {
                            e.preventDefault();
                            onPreviewTable?.(dbName, tableName);
                          }}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            onPreviewTable?.(dbName, tableName);
                          }}
                          data-testid={`table-node-${tableKey}`}
                          className="w-full flex items-center gap-1.5 px-2 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors text-left"
                          aria-label={`Table: ${tableName}`}
                        >
                          <span className="text-[10px] text-gray-400 dark:text-gray-500 w-3 flex-shrink-0">
                            {getChevron(isTableExpanded)}
                          </span>
                          <span className="flex-shrink-0">
                            {isTableExpanded ? '📋' : '📄'}
                          </span>
                          <span className="text-gray-900 dark:text-gray-100 truncate">
                            {tableName}
                          </span>
                          {isTableLoading && (
                            <span className="ml-auto flex-shrink-0">
                              <LoadingSpinner />
                            </span>
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
                                data-testid={`column-node-${tableKey}.${col.name}`}
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
                                  {formatColumnType(col.type)}
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
                                {col.defaultValue !== null && (
                                  <span className="text-blue-500 dark:text-blue-400 text-[10px] truncate max-w-[100px]" title={`Default: ${col.defaultValue}`}>
                                    ={col.defaultValue}
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
    </div>
  );
}

/**
 * Small loading spinner component for inline use.
 */
function LoadingSpinner() {
  return (
    <svg
      className="animate-spin h-3.5 w-3.5 text-gray-400 dark:text-gray-500"
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
