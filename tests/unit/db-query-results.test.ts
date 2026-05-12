import { describe, it, expect } from 'vitest';
import {
  getDisplayState,
  formatExecutionTime,
  getTruncationMessage,
  getAffectedRowsMessage,
  shouldShowExportButton,
  formatCellValue,
} from '@/components/db/query-results-utils';
import type { QueryResult } from '@/components/db/query-results-utils';

describe('QueryResults - getDisplayState', () => {
  it('should return "loading" when isLoading is true', () => {
    expect(getDisplayState(null, null, true)).toBe('loading');
  });

  it('should return "loading" even when result and error exist', () => {
    const result: QueryResult = {
      columns: ['id'],
      rows: [{ id: 1 }],
      rowCount: 1,
      truncated: false,
      executionTimeMs: 10,
    };
    expect(getDisplayState(result, 'some error', true)).toBe('loading');
  });

  it('should return "error" when error is present and not loading', () => {
    expect(getDisplayState(null, 'Syntax error', false)).toBe('error');
  });

  it('should return "error" when error is present even with result', () => {
    const result: QueryResult = {
      columns: ['id'],
      rows: [{ id: 1 }],
      rowCount: 1,
      truncated: false,
      executionTimeMs: 10,
    };
    expect(getDisplayState(result, 'Error occurred', false)).toBe('error');
  });

  it('should return "initial" when result is null and no error', () => {
    expect(getDisplayState(null, null, false)).toBe('initial');
  });

  it('should return "select" when result has columns', () => {
    const result: QueryResult = {
      columns: ['id', 'name'],
      rows: [{ id: 1, name: 'test' }],
      rowCount: 1,
      truncated: false,
      executionTimeMs: 50,
    };
    expect(getDisplayState(result, null, false)).toBe('select');
  });

  it('should return "mutation" when result has affectedRows and no columns', () => {
    const result: QueryResult = {
      columns: [],
      rows: [],
      rowCount: 0,
      truncated: false,
      affectedRows: 5,
      executionTimeMs: 20,
    };
    expect(getDisplayState(result, null, false)).toBe('mutation');
  });

  it('should return "empty" when result has no columns and no affectedRows', () => {
    const result: QueryResult = {
      columns: [],
      rows: [],
      rowCount: 0,
      truncated: false,
      executionTimeMs: 10,
    };
    expect(getDisplayState(result, null, false)).toBe('empty');
  });

  it('should return "mutation" when affectedRows is 0', () => {
    const result: QueryResult = {
      columns: [],
      rows: [],
      rowCount: 0,
      truncated: false,
      affectedRows: 0,
      executionTimeMs: 15,
    };
    expect(getDisplayState(result, null, false)).toBe('mutation');
  });
});

describe('QueryResults - formatExecutionTime', () => {
  it('should format milliseconds for times under 1000ms', () => {
    expect(formatExecutionTime(50)).toBe('50ms');
  });

  it('should format 0ms', () => {
    expect(formatExecutionTime(0)).toBe('0ms');
  });

  it('should format 999ms as milliseconds', () => {
    expect(formatExecutionTime(999)).toBe('999ms');
  });

  it('should format 1000ms as seconds', () => {
    expect(formatExecutionTime(1000)).toBe('1.00s');
  });

  it('should format 1500ms as seconds with decimals', () => {
    expect(formatExecutionTime(1500)).toBe('1.50s');
  });

  it('should format large values as seconds', () => {
    expect(formatExecutionTime(12345)).toBe('12.35s');
  });
});

describe('QueryResults - getTruncationMessage', () => {
  it('should include total rows when provided', () => {
    const msg = getTruncationMessage(1000, 5000);
    expect(msg).toBe('Results truncated: showing 1000 of 5000 total rows');
  });

  it('should show generic message when totalRows is undefined', () => {
    const msg = getTruncationMessage(1000);
    expect(msg).toBe('Results truncated: showing 1000 rows (limit: 1000)');
  });

  it('should use the actual rowCount in the message', () => {
    const msg = getTruncationMessage(500, 2000);
    expect(msg).toContain('500');
    expect(msg).toContain('2000');
  });
});

describe('QueryResults - getAffectedRowsMessage', () => {
  it('should show "No rows affected" for 0', () => {
    expect(getAffectedRowsMessage(0)).toBe(
      'Query executed successfully. No rows affected.'
    );
  });

  it('should show singular "1 row affected"', () => {
    expect(getAffectedRowsMessage(1)).toBe(
      'Query executed successfully. 1 row affected.'
    );
  });

  it('should show plural for multiple rows', () => {
    expect(getAffectedRowsMessage(5)).toBe(
      'Query executed successfully. 5 rows affected.'
    );
  });

  it('should handle large numbers', () => {
    expect(getAffectedRowsMessage(10000)).toBe(
      'Query executed successfully. 10000 rows affected.'
    );
  });
});

describe('QueryResults - shouldShowExportButton', () => {
  it('should return false when loading', () => {
    const result: QueryResult = {
      columns: ['id'],
      rows: [{ id: 1 }],
      rowCount: 1,
      truncated: false,
      executionTimeMs: 10,
    };
    expect(shouldShowExportButton(result, true)).toBe(false);
  });

  it('should return false when result is null', () => {
    expect(shouldShowExportButton(null, false)).toBe(false);
  });

  it('should return false when result has no columns (mutation)', () => {
    const result: QueryResult = {
      columns: [],
      rows: [],
      rowCount: 0,
      truncated: false,
      affectedRows: 3,
      executionTimeMs: 10,
    };
    expect(shouldShowExportButton(result, false)).toBe(false);
  });

  it('should return false when result has columns but no rows', () => {
    const result: QueryResult = {
      columns: ['id', 'name'],
      rows: [],
      rowCount: 0,
      truncated: false,
      executionTimeMs: 10,
    };
    expect(shouldShowExportButton(result, false)).toBe(false);
  });

  it('should return true when result has columns and rows', () => {
    const result: QueryResult = {
      columns: ['id', 'name'],
      rows: [{ id: 1, name: 'test' }],
      rowCount: 1,
      truncated: false,
      executionTimeMs: 10,
    };
    expect(shouldShowExportButton(result, false)).toBe(true);
  });
});

describe('QueryResults - formatCellValue', () => {
  it('should return "NULL" for null values', () => {
    expect(formatCellValue(null)).toBe('NULL');
  });

  it('should return empty string for undefined', () => {
    expect(formatCellValue(undefined)).toBe('');
  });

  it('should return string representation of numbers', () => {
    expect(formatCellValue(42)).toBe('42');
  });

  it('should return string representation of booleans', () => {
    expect(formatCellValue(true)).toBe('true');
    expect(formatCellValue(false)).toBe('false');
  });

  it('should return strings as-is', () => {
    expect(formatCellValue('hello')).toBe('hello');
  });

  it('should return empty string for empty string input', () => {
    expect(formatCellValue('')).toBe('');
  });

  it('should JSON stringify objects', () => {
    expect(formatCellValue({ key: 'value' })).toBe('{"key":"value"}');
  });

  it('should JSON stringify arrays', () => {
    expect(formatCellValue([1, 2, 3])).toBe('[1,2,3]');
  });

  it('should handle circular references gracefully', () => {
    const obj: any = {};
    obj.self = obj;
    expect(formatCellValue(obj)).toBe('[Object]');
  });
});
