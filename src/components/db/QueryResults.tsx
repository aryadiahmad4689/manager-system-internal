'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
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
  onCopyQuery?: (sql: string) => void;
  tableName?: string;
  /** Execute an UPDATE query directly */
  onExecuteUpdate?: (sql: string) => void;
}

interface ContextMenuState {
  visible: boolean;
  x: number;
  y: number;
  rowIdx: number;
}

interface EditingCell {
  rowIdx: number;
  colIdx: number;
  value: string;
  originalValue: any;
}

interface PendingEdit {
  rowIdx: number;
  col: string;
  newValue: string;
  originalValue: any;
}

export default function QueryResults({
  result,
  error,
  isLoading,
  onExport,
  onCopyQuery,
  tableName,
  onExecuteUpdate,
}: QueryResultsProps) {
  const [selectedRowIdx, setSelectedRowIdx] = useState<number | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({ visible: false, x: 0, y: 0, rowIdx: -1 });
  const [editingCell, setEditingCell] = useState<EditingCell | null>(null);
  const [pendingEdit, setPendingEdit] = useState<PendingEdit | null>(null);
  const [pkColumn, setPkColumn] = useState<string | null>(null);
  const [showPkPicker, setShowPkPicker] = useState(false);
  const [pendingEditForPk, setPendingEditForPk] = useState<PendingEdit | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const editInputRef = useRef<HTMLInputElement>(null);
  const displayState = getDisplayState(result, error, isLoading);
  const showExport = shouldShowExportButton(result, isLoading);

  // Focus input when editing starts (only on initial open, not on every value change)
  const prevEditingRef = useRef<{ rowIdx: number; colIdx: number } | null>(null);
  useEffect(() => {
    if (editingCell && editInputRef.current) {
      const isNewCell = !prevEditingRef.current ||
        prevEditingRef.current.rowIdx !== editingCell.rowIdx ||
        prevEditingRef.current.colIdx !== editingCell.colIdx;
      if (isNewCell) {
        editInputRef.current.focus();
        editInputRef.current.select();
      }
      prevEditingRef.current = { rowIdx: editingCell.rowIdx, colIdx: editingCell.colIdx };
    } else {
      prevEditingRef.current = null;
    }
  }, [editingCell]);

  // Close context menu on click outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setContextMenu((prev) => ({ ...prev, visible: false }));
      }
    }
    if (contextMenu.visible) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [contextMenu.visible]);

  // Close context menu on scroll
  useEffect(() => {
    function handleScroll() {
      setContextMenu((prev) => ({ ...prev, visible: false }));
    }
    document.addEventListener('scroll', handleScroll, true);
    return () => document.removeEventListener('scroll', handleScroll, true);
  }, []);

  // Global keyboard shortcut for save (Cmd+S / Ctrl+S)
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 's' && editingCell) {
        e.preventDefault();
        commitEdit();
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  });

  const handleRowClick = useCallback((rowIdx: number) => {
    if (editingCell) return; // Don't change selection while editing
    setSelectedRowIdx((prev) => (prev === rowIdx ? null : rowIdx));
  }, [editingCell]);

  const handleRowContextMenu = useCallback((e: React.MouseEvent, rowIdx: number) => {
    e.preventDefault();
    setSelectedRowIdx(rowIdx);
    setContextMenu({ visible: true, x: e.clientX, y: e.clientY, rowIdx });
  }, []);

  const handleCellDoubleClick = useCallback((rowIdx: number, colIdx: number) => {
    if (!result) return;
    const col = result.columns[colIdx];
    const val = result.rows[rowIdx][col];
    setEditingCell({
      rowIdx,
      colIdx,
      value: val === null ? '' : String(val),
      originalValue: val,
    });
    setSelectedRowIdx(rowIdx);
  }, [result]);

  const commitEdit = useCallback(() => {
    if (!editingCell || !result) return;
    const col = result.columns[editingCell.colIdx];
    const newValue = editingCell.value;
    const originalValue = editingCell.originalValue;

    // Check if value actually changed
    const originalStr = originalValue === null ? '' : String(originalValue);
    if (newValue === originalStr) {
      setEditingCell(null);
      return;
    }

    const edit: PendingEdit = {
      rowIdx: editingCell.rowIdx,
      col,
      newValue,
      originalValue,
    };

    // Check if we have a primary key column
    if (!pkColumn) {
      // Need to ask user to pick a PK column
      setPendingEditForPk(edit);
      setShowPkPicker(true);
      setEditingCell(null);
      return;
    }

    setPendingEdit(edit);
    setEditingCell(null);
  }, [editingCell, result, pkColumn]);

  const handleEditKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitEdit();
    } else if (e.key === 'Escape') {
      setEditingCell(null);
    }
  }, [commitEdit]);

  const handleConfirmUpdate = useCallback(() => {
    if (!pendingEdit || !result || !tableName) {
      setPendingEdit(null);
      return;
    }

    const table = tableName;
    const row = result.rows[pendingEdit.rowIdx];
    const pkCol = pkColumn || result.columns[0];
    const pkVal = row[pkCol];

    const whereClause = pkVal === null
      ? `\`${pkCol}\` IS NULL`
      : typeof pkVal === 'number'
        ? `\`${pkCol}\` = ${pkVal}`
        : `\`${pkCol}\` = '${String(pkVal).replace(/'/g, "''")}'`;

    const newVal = pendingEdit.newValue === '' ? 'NULL' : `'${pendingEdit.newValue.replace(/'/g, "''")}'`;
    const sql = `UPDATE ${table} SET \`${pendingEdit.col}\` = ${newVal} WHERE ${whereClause};`;

    if (onExecuteUpdate) {
      onExecuteUpdate(sql);
    } else if (onCopyQuery) {
      onCopyQuery(sql);
    }

    setPendingEdit(null);
  }, [pendingEdit, result, tableName, pkColumn, onExecuteUpdate, onCopyQuery]);

  const handleCancelUpdate = useCallback(() => {
    setPendingEdit(null);
  }, []);

  const handleSelectPk = useCallback((col: string) => {
    setPkColumn(col);
    setShowPkPicker(false);
    // Now proceed with the pending edit
    if (pendingEditForPk) {
      setPendingEdit(pendingEditForPk);
      setPendingEditForPk(null);
    }
  }, [pendingEditForPk]);

  const handleCancelPkPicker = useCallback(() => {
    setShowPkPicker(false);
    setPendingEditForPk(null);
  }, []);

  const generateInsertQuery = useCallback((row: Record<string, any>) => {
    if (!result) return '';
    const table = tableName || '`table_name`';
    const cols = result.columns.map((c) => `\`${c}\``).join(', ');
    const vals = result.columns.map((col) => {
      const val = row[col];
      if (val === null) return 'NULL';
      if (typeof val === 'number') return String(val);
      return `'${String(val).replace(/'/g, "''")}'`;
    }).join(', ');
    return `INSERT INTO ${table} (${cols}) VALUES (${vals});`;
  }, [result, tableName]);

  const generateUpdateQuery = useCallback((row: Record<string, any>) => {
    if (!result) return '';
    const table = tableName || '`table_name`';
    const setClauses = result.columns.map((col) => {
      const val = row[col];
      if (val === null) return `\`${col}\` = NULL`;
      if (typeof val === 'number') return `\`${col}\` = ${val}`;
      return `\`${col}\` = '${String(val).replace(/'/g, "''")}'`;
    }).join(', ');
    const pkCol = pkColumn || result.columns[0];
    const pkVal = row[pkCol];
    const whereClause = pkVal === null
      ? `\`${pkCol}\` IS NULL`
      : typeof pkVal === 'number'
        ? `\`${pkCol}\` = ${pkVal}`
        : `\`${pkCol}\` = '${String(pkVal).replace(/'/g, "''")}'`;
    return `UPDATE ${table} SET ${setClauses} WHERE ${whereClause};`;
  }, [result, tableName, pkColumn]);

  const generateDeleteQuery = useCallback((row: Record<string, any>) => {
    if (!result) return '';
    const table = tableName || '`table_name`';
    const pkCol = pkColumn || result.columns[0];
    const pkVal = row[pkCol];
    const whereClause = pkVal === null
      ? `\`${pkCol}\` IS NULL`
      : typeof pkVal === 'number'
        ? `\`${pkCol}\` = ${pkVal}`
        : `\`${pkCol}\` = '${String(pkVal).replace(/'/g, "''")}'`;
    return `DELETE FROM ${table} WHERE ${whereClause};`;
  }, [result, tableName, pkColumn]);

  const handleCopyInsert = useCallback(() => {
    if (!result || contextMenu.rowIdx < 0) return;
    const row = result.rows[contextMenu.rowIdx];
    const sql = generateInsertQuery(row);
    if (onCopyQuery) onCopyQuery(sql); else navigator.clipboard.writeText(sql);
    setContextMenu((prev) => ({ ...prev, visible: false }));
  }, [result, contextMenu.rowIdx, generateInsertQuery, onCopyQuery]);

  const handleCopyUpdate = useCallback(() => {
    if (!result || contextMenu.rowIdx < 0) return;
    const row = result.rows[contextMenu.rowIdx];
    const sql = generateUpdateQuery(row);
    if (onCopyQuery) onCopyQuery(sql); else navigator.clipboard.writeText(sql);
    setContextMenu((prev) => ({ ...prev, visible: false }));
  }, [result, contextMenu.rowIdx, generateUpdateQuery, onCopyQuery]);

  const handleCopyDelete = useCallback(() => {
    if (!result || contextMenu.rowIdx < 0) return;
    const row = result.rows[contextMenu.rowIdx];
    const sql = generateDeleteQuery(row);
    if (onCopyQuery) onCopyQuery(sql); else navigator.clipboard.writeText(sql);
    setContextMenu((prev) => ({ ...prev, visible: false }));
  }, [result, contextMenu.rowIdx, generateDeleteQuery, onCopyQuery]);

  const handleDuplicateRow = useCallback(() => {
    if (!result || contextMenu.rowIdx < 0) return;
    const row = result.rows[contextMenu.rowIdx];
    const sql = generateInsertQuery(row);
    if (onCopyQuery) onCopyQuery(sql); else navigator.clipboard.writeText(sql);
    setContextMenu((prev) => ({ ...prev, visible: false }));
  }, [result, contextMenu.rowIdx, generateInsertQuery, onCopyQuery]);

  return (
    <div
      data-testid="query-results"
      className="flex flex-col border border-gray-300 dark:border-gray-600 rounded-lg overflow-hidden h-full relative"
    >
      {/* Header bar */}
      <div className="flex items-center justify-between px-3 py-2 bg-gray-100 dark:bg-gray-800 border-b border-gray-300 dark:border-gray-600">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Results
          </span>
          {pkColumn && (
            <span className="text-[10px] px-1.5 py-0.5 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 rounded">
              PK: {pkColumn}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {result && !isLoading && (
            <span data-testid="execution-time" className="text-xs text-gray-500 dark:text-gray-400">
              {formatExecutionTime(result.executionTimeMs)}
            </span>
          )}
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
        <div data-testid="truncation-notice" className="px-3 py-2 bg-yellow-50 dark:bg-yellow-900/20 border-b border-yellow-200 dark:border-yellow-700">
          <p className="text-xs text-yellow-700 dark:text-yellow-300">
            ⚠️ {getTruncationMessage(result.rowCount, result.totalRows)}
          </p>
        </div>
      )}

      {/* Content area */}
      <div className="flex-1 min-h-[100px] overflow-auto">
        {displayState === 'loading' && (
          <div data-testid="loading-indicator" className="flex items-center justify-center h-[150px]">
            <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400">
              <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              <span className="text-sm">Executing query...</span>
            </div>
          </div>
        )}

        {displayState === 'error' && (
          <div data-testid="error-message" className="p-4">
            <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded">
              <p className="text-sm text-red-700 dark:text-red-300 font-mono whitespace-pre-wrap">{error}</p>
            </div>
          </div>
        )}

        {displayState === 'initial' && (
          <div data-testid="initial-state" className="flex items-center justify-center h-[150px] text-gray-500 dark:text-gray-400">
            <p className="text-sm">Run a query to see results here.</p>
          </div>
        )}

        {displayState === 'empty' && (
          <div data-testid="empty-results" className="flex items-center justify-center h-[150px] text-gray-500 dark:text-gray-400">
            <p className="text-sm">No results returned.</p>
          </div>
        )}

        {displayState === 'mutation' && result && (
          <div data-testid="mutation-result" className="flex items-center justify-center h-[150px]">
            <div className="text-center">
              <svg className="mx-auto h-8 w-8 text-green-500 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <p className="text-sm text-gray-700 dark:text-gray-300">{getAffectedRowsMessage(result.affectedRows ?? 0)}</p>
            </div>
          </div>
        )}

        {/* SELECT results table */}
        {displayState === 'select' && result && (
          <table data-testid="results-table" className="w-full text-sm text-left">
            <thead className="sticky top-0 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-600 z-10">
              <tr>
                {result.columns.map((col, idx) => (
                  <th
                    key={idx}
                    className={`px-3 py-2 text-xs font-semibold whitespace-nowrap cursor-pointer hover:text-blue-600 dark:hover:text-blue-400 ${
                      pkColumn === col ? 'text-green-600 dark:text-green-400' : 'text-gray-600 dark:text-gray-300'
                    }`}
                    onClick={() => setPkColumn(col)}
                    title={pkColumn === col ? `Primary key: ${col}` : `Click to set as primary key`}
                  >
                    {pkColumn === col && <span className="mr-1">🔑</span>}
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {result.rows.map((row, rowIdx) => (
                <tr
                  key={rowIdx}
                  onClick={() => handleRowClick(rowIdx)}
                  onContextMenu={(e) => handleRowContextMenu(e, rowIdx)}
                  className={`transition-colors ${
                    selectedRowIdx === rowIdx
                      ? 'bg-orange-100 dark:bg-orange-900/30 border-l-2 border-l-orange-400'
                      : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'
                  }`}
                >
                  {result.columns.map((col, colIdx) => (
                    <td
                      key={colIdx}
                      onDoubleClick={() => handleCellDoubleClick(rowIdx, colIdx)}
                      className={`px-3 py-1.5 text-xs whitespace-nowrap cursor-pointer ${
                        editingCell?.rowIdx === rowIdx && editingCell?.colIdx === colIdx
                          ? 'p-0'
                          : row[col] === null
                            ? 'text-gray-400 dark:text-gray-500 italic'
                            : 'text-gray-900 dark:text-gray-100'
                      }`}
                    >
                      {editingCell?.rowIdx === rowIdx && editingCell?.colIdx === colIdx ? (
                        <input
                          ref={editInputRef}
                          type="text"
                          value={editingCell.value}
                          onChange={(e) => setEditingCell({ ...editingCell, value: e.target.value })}
                          onKeyDown={handleEditKeyDown}
                          onBlur={commitEdit}
                          className="w-full px-2 py-1 text-xs bg-yellow-50 dark:bg-yellow-900/30 border-2 border-orange-400 dark:border-orange-500 rounded outline-none text-gray-900 dark:text-gray-100"
                        />
                      ) : (
                        formatCellValue(row[col])
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Footer */}
      {displayState === 'select' && result && (
        <div className="px-3 py-1.5 bg-gray-50 dark:bg-gray-800 border-t border-gray-200 dark:border-gray-600 flex items-center justify-between">
          <span data-testid="row-count" className="text-xs text-gray-500 dark:text-gray-400">
            {result.rowCount} {result.rowCount === 1 ? 'row' : 'rows'}
          </span>
          <span className="text-[10px] text-gray-400 dark:text-gray-500">
            Double-click cell to edit • Right-click row for options
          </span>
        </div>
      )}

      {/* Context menu */}
      {contextMenu.visible && (
        <div
          ref={contextMenuRef}
          className="fixed z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg py-1 min-w-[180px]"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          data-testid="row-context-menu"
        >
          <button type="button" onClick={handleCopyInsert} className="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-700 dark:text-gray-200 hover:bg-orange-50 dark:hover:bg-orange-900/20 transition-colors text-left">
            <span className="text-green-600 dark:text-green-400">INSERT</span>
            <span className="text-gray-500 dark:text-gray-400">Copy INSERT query</span>
          </button>
          <button type="button" onClick={handleCopyUpdate} className="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-700 dark:text-gray-200 hover:bg-orange-50 dark:hover:bg-orange-900/20 transition-colors text-left">
            <span className="text-blue-600 dark:text-blue-400">UPDATE</span>
            <span className="text-gray-500 dark:text-gray-400">Copy UPDATE query</span>
          </button>
          <button type="button" onClick={handleCopyDelete} className="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-700 dark:text-gray-200 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors text-left">
            <span className="text-red-600 dark:text-red-400">DELETE</span>
            <span className="text-gray-500 dark:text-gray-400">Copy DELETE query</span>
          </button>
          <div className="border-t border-gray-100 dark:border-gray-700 my-1" />
          <button type="button" onClick={handleDuplicateRow} className="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-700 dark:text-gray-200 hover:bg-orange-50 dark:hover:bg-orange-900/20 transition-colors text-left">
            <span>📋</span>
            <span>Duplicate row (INSERT)</span>
          </button>
        </div>
      )}

      {/* Confirm Update Modal */}
      {pendingEdit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/60" onClick={handleCancelUpdate} aria-hidden="true" />
          <div className="relative w-full max-w-md bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl p-5">
            <div className="flex items-center gap-3 mb-3">
              <div className="flex-shrink-0 w-9 h-9 flex items-center justify-center rounded-full bg-orange-100 dark:bg-orange-900/30">
                <svg className="w-4 h-4 text-orange-600 dark:text-orange-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
              </div>
              <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">Confirm Update</h3>
            </div>
            <div className="mb-3 text-sm text-gray-600 dark:text-gray-300">
              <p>Are you sure you want to update column <strong className="text-orange-600 dark:text-orange-400">{pendingEdit.col}</strong>?</p>
              <div className="mt-2 p-2 bg-gray-50 dark:bg-gray-900 rounded text-xs font-mono">
                <div><span className="text-gray-500">From:</span> <span className="text-red-600 dark:text-red-400">{pendingEdit.originalValue === null ? 'NULL' : String(pendingEdit.originalValue)}</span></div>
                <div><span className="text-gray-500">To:</span> <span className="text-green-600 dark:text-green-400">{pendingEdit.newValue || 'NULL'}</span></div>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2">
              <button type="button" onClick={handleCancelUpdate} className="px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded transition-colors">
                Cancel
              </button>
              <button type="button" onClick={handleConfirmUpdate} className="px-3 py-1.5 text-xs font-medium text-white bg-orange-600 hover:bg-orange-700 rounded transition-colors">
                Update
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Primary Key Picker Modal */}
      {showPkPicker && result && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/60" onClick={handleCancelPkPicker} aria-hidden="true" />
          <div className="relative w-full max-w-sm bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl p-5">
            <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-2">Select Primary Key</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
              Choose a column to use as the WHERE condition for UPDATE queries. This is usually the primary key (ID) column.
            </p>
            <div className="max-h-[200px] overflow-y-auto space-y-1">
              {result.columns.map((col) => (
                <button
                  key={col}
                  type="button"
                  onClick={() => handleSelectPk(col)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs text-left rounded hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors text-gray-700 dark:text-gray-200"
                >
                  <span>🔑</span>
                  <span className="font-medium">{col}</span>
                </button>
              ))}
            </div>
            <div className="mt-3 flex justify-end">
              <button type="button" onClick={handleCancelPkPicker} className="px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded transition-colors">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
