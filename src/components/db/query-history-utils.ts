/**
 * Utility functions for the QueryHistory component.
 * Extracted for testability since the component requires a browser environment.
 */

export interface QueryHistoryEntry {
  id: string;
  queryText: string;
  databaseName: string | null;
  status: 'success' | 'error';
  errorMessage: string | null;
  executionTimeMs: number | null;
  rowCount: number | null;
  executedAt: string;
}

/**
 * Truncates a query string to a maximum length, appending ellipsis if truncated.
 * Collapses whitespace (newlines, tabs, multiple spaces) into single spaces for display.
 */
export function truncateQuery(query: string, maxLength: number = 80): string {
  // Collapse whitespace for display
  const collapsed = query.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= maxLength) {
    return collapsed;
  }
  return collapsed.slice(0, maxLength) + '…';
}

/**
 * Formats a timestamp string into a relative or absolute display string.
 * - Less than 1 minute: "just now"
 * - Less than 1 hour: "Xm ago"
 * - Less than 24 hours: "Xh ago"
 * - Otherwise: formatted date string (YYYY-MM-DD HH:mm)
 */
export function formatTimestamp(executedAt: string, now?: Date): string {
  const date = new Date(executedAt);
  const current = now ?? new Date();
  const diffMs = current.getTime() - date.getTime();

  if (diffMs < 0) {
    // Future date, just show absolute
    return formatAbsoluteDate(date);
  }

  const diffMinutes = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);

  if (diffMinutes < 1) {
    return 'just now';
  }
  if (diffMinutes < 60) {
    return `${diffMinutes}m ago`;
  }
  if (diffHours < 24) {
    return `${diffHours}h ago`;
  }

  return formatAbsoluteDate(date);
}

/**
 * Formats a Date object into YYYY-MM-DD HH:mm format.
 */
export function formatAbsoluteDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

/**
 * Returns the CSS classes for the status indicator dot.
 */
export function getStatusClasses(status: 'success' | 'error'): {
  dotClass: string;
  label: string;
} {
  if (status === 'success') {
    return {
      dotClass: 'bg-green-500',
      label: 'Success',
    };
  }
  return {
    dotClass: 'bg-red-500',
    label: 'Error',
  };
}
