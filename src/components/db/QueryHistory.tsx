'use client';

import {
  truncateQuery,
  formatTimestamp,
  getStatusClasses,
} from './query-history-utils';
import type { QueryHistoryEntry } from './query-history-utils';

export type { QueryHistoryEntry };

export interface QueryHistoryProps {
  entries: QueryHistoryEntry[];
  onSelectQuery: (queryText: string) => void;
  isLoading?: boolean;
}

export default function QueryHistory({
  entries,
  onSelectQuery,
  isLoading = false,
}: QueryHistoryProps) {
  return (
    <div
      data-testid="query-history"
      className="flex flex-col border border-gray-300 dark:border-gray-600 rounded-lg overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-gray-100 dark:bg-gray-800 border-b border-gray-300 dark:border-gray-600">
        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
          Query History
        </span>
        {entries.length > 0 && !isLoading && (
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {entries.length} {entries.length === 1 ? 'entry' : 'entries'}
          </span>
        )}
      </div>

      {/* Content */}
      <div className="max-h-[300px] overflow-y-auto">
        {/* Loading state */}
        {isLoading && (
          <div
            data-testid="history-loading"
            className="flex items-center justify-center py-8"
          >
            <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400">
              <svg
                className="animate-spin h-4 w-4"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                aria-hidden="true"
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
              <span className="text-sm">Loading history...</span>
            </div>
          </div>
        )}

        {/* Empty state */}
        {!isLoading && entries.length === 0 && (
          <div
            data-testid="history-empty"
            className="flex items-center justify-center py-8 text-gray-500 dark:text-gray-400"
          >
            <p className="text-sm">No query history yet.</p>
          </div>
        )}

        {/* History entries */}
        {!isLoading && entries.length > 0 && (
          <ul
            data-testid="history-list"
            className="divide-y divide-gray-100 dark:divide-gray-700"
            role="list"
          >
            {entries.map((entry) => {
              const statusInfo = getStatusClasses(entry.status);
              return (
                <li key={entry.id}>
                  <button
                    type="button"
                    onClick={() => onSelectQuery(entry.queryText)}
                    className="w-full text-left px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors focus:outline-none focus:bg-gray-50 dark:focus:bg-gray-700/50"
                    aria-label={`Load query: ${truncateQuery(entry.queryText, 40)}`}
                    data-testid={`history-entry-${entry.id}`}
                  >
                    {/* Query text */}
                    <p className="text-xs font-mono text-gray-900 dark:text-gray-100 truncate">
                      {truncateQuery(entry.queryText)}
                    </p>

                    {/* Metadata row */}
                    <div className="flex items-center gap-2 mt-1">
                      {/* Status dot */}
                      <span
                        className={`inline-block w-2 h-2 rounded-full ${statusInfo.dotClass}`}
                        title={statusInfo.label}
                        aria-label={statusInfo.label}
                      />

                      {/* Database name */}
                      {entry.databaseName && (
                        <span className="text-xs text-gray-500 dark:text-gray-400">
                          {entry.databaseName}
                        </span>
                      )}

                      {/* Separator */}
                      {entry.databaseName && (
                        <span className="text-xs text-gray-300 dark:text-gray-600">
                          •
                        </span>
                      )}

                      {/* Timestamp */}
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        {formatTimestamp(entry.executedAt)}
                      </span>

                      {/* Execution time (if available) */}
                      {entry.executionTimeMs !== null && (
                        <>
                          <span className="text-xs text-gray-300 dark:text-gray-600">
                            •
                          </span>
                          <span className="text-xs text-gray-500 dark:text-gray-400">
                            {entry.executionTimeMs}ms
                          </span>
                        </>
                      )}
                    </div>

                    {/* Error message (if error) */}
                    {entry.status === 'error' && entry.errorMessage && (
                      <p className="text-xs text-red-600 dark:text-red-400 mt-1 truncate">
                        {entry.errorMessage}
                      </p>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
