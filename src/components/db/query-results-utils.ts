/**
 * Utility functions for the QueryResults component.
 * Extracted for testability since the component requires a browser environment.
 */

export interface QueryResult {
  columns: string[];
  rows: Record<string, any>[];
  rowCount: number;
  totalRows?: number;
  truncated: boolean;
  affectedRows?: number;
  executionTimeMs: number;
}

export type ResultDisplayState =
  | 'loading'
  | 'error'
  | 'empty'
  | 'select'
  | 'mutation'
  | 'initial';

/**
 * Determines the display state of the query results component.
 */
export function getDisplayState(
  result: QueryResult | null,
  error: string | null,
  isLoading: boolean
): ResultDisplayState {
  if (isLoading) return 'loading';
  if (error) return 'error';
  if (!result) return 'initial';

  // If there are columns, it's a SELECT result
  if (result.columns.length > 0) return 'select';

  // If affectedRows is defined, it's an INSERT/UPDATE/DELETE
  if (result.affectedRows !== undefined) return 'mutation';

  return 'empty';
}

/**
 * Formats execution time for display.
 * Shows milliseconds for times under 1000ms, seconds otherwise.
 */
export function formatExecutionTime(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  return `${(ms / 1000).toFixed(2)}s`;
}

/**
 * Generates the truncation notification message.
 */
export function getTruncationMessage(
  rowCount: number,
  totalRows?: number
): string {
  if (totalRows !== undefined) {
    return `Results truncated: showing ${rowCount} of ${totalRows} total rows`;
  }
  return `Results truncated: showing ${rowCount} rows (limit: 1000)`;
}

/**
 * Formats the affected rows message for INSERT/UPDATE/DELETE operations.
 */
export function getAffectedRowsMessage(affectedRows: number): string {
  if (affectedRows === 0) {
    return 'Query executed successfully. No rows affected.';
  }
  if (affectedRows === 1) {
    return 'Query executed successfully. 1 row affected.';
  }
  return `Query executed successfully. ${affectedRows} rows affected.`;
}

/**
 * Determines whether the Export CSV button should be shown.
 * Only shown when there are SELECT results with data.
 */
export function shouldShowExportButton(
  result: QueryResult | null,
  isLoading: boolean
): boolean {
  if (isLoading || !result) return false;
  return result.columns.length > 0 && result.rowCount > 0;
}

/**
 * Formats a cell value for display in the results table.
 * Handles null, undefined, objects, and long strings.
 */
export function formatCellValue(value: any): string {
  if (value === null) return 'NULL';
  if (value === undefined) return '';
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return '[Object]';
    }
  }
  return String(value);
}
