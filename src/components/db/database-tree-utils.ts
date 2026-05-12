/**
 * Utility functions for the DatabaseTreeView component.
 * Extracted for testability since the component requires a browser environment.
 */

export interface ColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
  primaryKey: boolean;
  defaultValue: string | null;
}

export type NodeType = 'database' | 'table' | 'column';

export interface TreeNodeState {
  expanded: boolean;
  type: NodeType;
}

/**
 * Generates a unique key for a table node in the tree.
 * Format: "databaseName.tableName"
 */
export function getTableNodeKey(dbName: string, tableName: string): string {
  return `${dbName}.${tableName}`;
}

/**
 * Parses a table node key back into database and table names.
 */
export function parseTableNodeKey(key: string): { dbName: string; tableName: string } | null {
  const dotIndex = key.indexOf('.');
  if (dotIndex === -1) {
    return null;
  }
  return {
    dbName: key.substring(0, dotIndex),
    tableName: key.substring(dotIndex + 1),
  };
}

/**
 * Formats a column's type information for display.
 * Example: "VARCHAR(255)" or "INT"
 */
export function formatColumnType(type: string): string {
  return type.toUpperCase();
}

/**
 * Builds a display string for a column with its metadata.
 * Example: "id INT PK NOT NULL" or "name VARCHAR(255) NULL DEFAULT 'unnamed'"
 */
export function formatColumnDisplay(column: ColumnInfo): string {
  const parts: string[] = [column.name, formatColumnType(column.type)];

  if (column.primaryKey) {
    parts.push('PK');
  }

  parts.push(column.nullable ? 'NULL' : 'NOT NULL');

  if (column.defaultValue !== null) {
    parts.push(`DEFAULT ${column.defaultValue}`);
  }

  return parts.join(' ');
}

/**
 * Determines if a database is access-denied based on the accessDenied list.
 */
export function isDatabaseAccessDenied(dbName: string, accessDenied: string[]): boolean {
  return accessDenied.includes(dbName);
}

/**
 * Returns the appropriate icon indicator for a node type.
 */
export function getNodeIcon(type: NodeType, expanded: boolean): string {
  switch (type) {
    case 'database':
      return expanded ? '📂' : '📁';
    case 'table':
      return expanded ? '📋' : '📄';
    case 'column':
      return '🔹';
  }
}

/**
 * Returns the chevron character for expand/collapse state.
 */
export function getChevron(expanded: boolean): string {
  return expanded ? '▼' : '▶';
}
