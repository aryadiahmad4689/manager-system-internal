'use client';

import {
  getDisplayState,
  formatExecutionTime,
  getTruncationMessage,
  getAffectedRowsMessage,
  shouldShowExportButton,
  formatCellValue,
} from './query-results-utils';
import type { QueryResult } from './query-results-utils';

export type { QueryResult };

export interface QueryResultsProps {
  result: QueryResult | null;
  error: string | null;
  isLoading: boolean;
  onExport: () => void;
}

export default function QueryResults({
  result,
  error,
  isLoading,
  onExport,
}: QueryResultsProps) {
  const displayState = getDisplayState(result, error, isLoading);
  const showExport = shouldShowExportButton(result, isLoading);

  return (
    <div
      data-testid="query-results"
      className="flex flex-col border border-gray-300 dark:border-gray-600 rounded-lg overflow-hidden"
    >
      {/* Header bar */}
      <div className="flex items-center justify-between px-3 py-2 bg-gray-100 dark:bg-gray-800 border-b border-gray-300 dark:border-gray-600">
        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
          Results
        </span>
        <div className="flex items-center gap-3">
          {/* Execution time */}
          {result && !isLoading && (
            <span
              data-testid="execution-time"
              className="text-xs text-gray-500 dark:text-gray-400"
            >
              {formatExecutionTime(result.executionTimeMs)}
            </span>
          )}
          {/* Export CSV button */}
          {showExport && (
            <button
              type="button"
              onClick={onExport}
              data-testid="export-csv-btn"
              className="px-3 py-1 text-xs font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600 border border-gray-300 dark:border-gray-500 rounded transition-colors"
              aria-label="Export CSV"
            >
              Export CSV
            </button>
          )}
        </div>
      </div>

      {/* Truncation notification */}
      {result && result.truncated && !isLoading && (
        <div
          data-testid="truncation-notice"
          className="px-3 py-2 bg-yellow-50 dark:bg-yellow-900/20 border-b border-yellow-200 dark:border-yellow-700"
        >
          <p className="text-xs text-yellow-700 dark:text-yellow-300">
            ⚠️ {getTruncationMessage(result.rowCount, result.totalRows)}
          </p>
        </div>
      )}

      {/* Content area */}
      <div className="min-h-[150px] max-h-[400px] overflow-auto">
        {/* Loading state */}
        {displayState === 'loading' && (
          <div
            data-testid="loading-indicator"
            className="flex items-center justify-center h-[150px]"
          >
            <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400">
              <svg
                className="animate-spin h-5 w-5"
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
              <span className="text-sm">Executing query...</span>
            </div>
          </div>
        )}

        {/* Error state */}
        {displayState === 'error' && (
          <div
            data-testid="error-message"
            className="p-4"
          >
            <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded">
              <p className="text-sm text-red-700 dark:text-red-300 font-mono whitespace-pre-wrap">
                {error}
              </p>
            </div>
          </div>
        )}

        {/* Initial/empty state */}
        {displayState === 'initial' && (
          <div
            data-testid="initial-state"
            className="flex items-center justify-center h-[150px] text-gray-500 dark:text-gray-400"
          >
            <p className="text-sm">Run a query to see results here.</p>
          </div>
        )}

        {/* Empty result state */}
        {displayState === 'empty' && (
          <div
            data-testid="empty-results"
            className="flex items-center justify-center h-[150px] text-gray-500 dark:text-gray-400"
          >
            <p className="text-sm">No results returned.</p>
          </div>
        )}

        {/* Mutation result (INSERT/UPDATE/DELETE) */}
        {displayState === 'mutation' && result && (
          <div
            data-testid="mutation-result"
            className="flex items-center justify-center h-[150px]"
          >
            <div className="text-center">
              <svg
                className="mx-auto h-8 w-8 text-green-500 mb-2"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 13l4 4L19 7"
                />
              </svg>
              <p className="text-sm text-gray-700 dark:text-gray-300">
                {getAffectedRowsMessage(result.affectedRows ?? 0)}
              </p>
            </div>
          </div>
        )}

        {/* SELECT results table */}
        {displayState === 'select' && result && (
          <table
            data-testid="results-table"
            className="w-full text-sm text-left"
          >
            <thead className="sticky top-0 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-600">
              <tr>
                {result.columns.map((col, idx) => (
                  <th
                    key={idx}
                    className="px-3 py-2 text-xs font-semibold text-gray-600 dark:text-gray-300 whitespace-nowrap"
                  >
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {result.rows.map((row, rowIdx) => (
                <tr
                  key={rowIdx}
                  className="hover:bg-gray-50 dark:hover:bg-gray-700/50"
                >
                  {result.columns.map((col, colIdx) => (
                    <td
                      key={colIdx}
                      className={`px-3 py-1.5 text-xs whitespace-nowrap ${
                        row[col] === null
                          ? 'text-gray-400 dark:text-gray-500 italic'
                          : 'text-gray-900 dark:text-gray-100'
                      }`}
                    >
                      {formatCellValue(row[col])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Footer with row count */}
      {displayState === 'select' && result && (
        <div className="px-3 py-1.5 bg-gray-50 dark:bg-gray-800 border-t border-gray-200 dark:border-gray-600">
          <span
            data-testid="row-count"
            className="text-xs text-gray-500 dark:text-gray-400"
          >
            {result.rowCount} {result.rowCount === 1 ? 'row' : 'rows'}
          </span>
        </div>
      )}
    </div>
  );
}
