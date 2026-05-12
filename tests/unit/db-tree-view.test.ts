import { describe, it, expect } from 'vitest';
import {
  getTableNodeKey,
  parseTableNodeKey,
  formatColumnType,
  formatColumnDisplay,
  isDatabaseAccessDenied,
  getNodeIcon,
  getChevron,
} from '../../src/components/db/database-tree-utils';
import type { ColumnInfo } from '../../src/components/db/database-tree-utils';

describe('database-tree-utils', () => {
  describe('getTableNodeKey', () => {
    it('should combine database and table name with a dot separator', () => {
      expect(getTableNodeKey('mydb', 'users')).toBe('mydb.users');
    });

    it('should handle names with special characters', () => {
      expect(getTableNodeKey('my-db', 'user_table')).toBe('my-db.user_table');
    });

    it('should handle empty strings', () => {
      expect(getTableNodeKey('', '')).toBe('.');
    });
  });

  describe('parseTableNodeKey', () => {
    it('should parse a valid key into database and table names', () => {
      const result = parseTableNodeKey('mydb.users');
      expect(result).toEqual({ dbName: 'mydb', tableName: 'users' });
    });

    it('should handle table names containing dots', () => {
      const result = parseTableNodeKey('mydb.schema.table');
      expect(result).toEqual({ dbName: 'mydb', tableName: 'schema.table' });
    });

    it('should return null for keys without a dot', () => {
      expect(parseTableNodeKey('nodot')).toBeNull();
    });

    it('should handle empty string', () => {
      expect(parseTableNodeKey('')).toBeNull();
    });
  });

  describe('formatColumnType', () => {
    it('should uppercase the type string', () => {
      expect(formatColumnType('varchar(255)')).toBe('VARCHAR(255)');
    });

    it('should handle already uppercase types', () => {
      expect(formatColumnType('INT')).toBe('INT');
    });

    it('should handle mixed case', () => {
      expect(formatColumnType('bigInt')).toBe('BIGINT');
    });
  });

  describe('formatColumnDisplay', () => {
    it('should format a basic non-nullable column', () => {
      const col: ColumnInfo = {
        name: 'id',
        type: 'int',
        nullable: false,
        primaryKey: false,
        defaultValue: null,
      };
      expect(formatColumnDisplay(col)).toBe('id INT NOT NULL');
    });

    it('should include PK indicator for primary key columns', () => {
      const col: ColumnInfo = {
        name: 'id',
        type: 'int',
        nullable: false,
        primaryKey: true,
        defaultValue: null,
      };
      expect(formatColumnDisplay(col)).toBe('id INT PK NOT NULL');
    });

    it('should show NULL for nullable columns', () => {
      const col: ColumnInfo = {
        name: 'email',
        type: 'varchar(255)',
        nullable: true,
        primaryKey: false,
        defaultValue: null,
      };
      expect(formatColumnDisplay(col)).toBe('email VARCHAR(255) NULL');
    });

    it('should include default value when present', () => {
      const col: ColumnInfo = {
        name: 'status',
        type: 'varchar(20)',
        nullable: false,
        primaryKey: false,
        defaultValue: "'active'",
      };
      expect(formatColumnDisplay(col)).toBe("status VARCHAR(20) NOT NULL DEFAULT 'active'");
    });

    it('should format a primary key with default value', () => {
      const col: ColumnInfo = {
        name: 'id',
        type: 'int',
        nullable: false,
        primaryKey: true,
        defaultValue: 'AUTO_INCREMENT',
      };
      expect(formatColumnDisplay(col)).toBe('id INT PK NOT NULL DEFAULT AUTO_INCREMENT');
    });
  });

  describe('isDatabaseAccessDenied', () => {
    it('should return true when database is in the access denied list', () => {
      expect(isDatabaseAccessDenied('secret_db', ['secret_db', 'admin_db'])).toBe(true);
    });

    it('should return false when database is not in the access denied list', () => {
      expect(isDatabaseAccessDenied('public_db', ['secret_db', 'admin_db'])).toBe(false);
    });

    it('should return false for empty access denied list', () => {
      expect(isDatabaseAccessDenied('any_db', [])).toBe(false);
    });

    it('should be case-sensitive', () => {
      expect(isDatabaseAccessDenied('Secret_DB', ['secret_db'])).toBe(false);
    });
  });

  describe('getNodeIcon', () => {
    it('should return open folder icon for expanded database', () => {
      expect(getNodeIcon('database', true)).toBe('📂');
    });

    it('should return closed folder icon for collapsed database', () => {
      expect(getNodeIcon('database', false)).toBe('📁');
    });

    it('should return clipboard icon for expanded table', () => {
      expect(getNodeIcon('table', true)).toBe('📋');
    });

    it('should return document icon for collapsed table', () => {
      expect(getNodeIcon('table', false)).toBe('📄');
    });

    it('should return diamond icon for column regardless of expanded state', () => {
      expect(getNodeIcon('column', true)).toBe('🔹');
      expect(getNodeIcon('column', false)).toBe('🔹');
    });
  });

  describe('getChevron', () => {
    it('should return down arrow for expanded state', () => {
      expect(getChevron(true)).toBe('▼');
    });

    it('should return right arrow for collapsed state', () => {
      expect(getChevron(false)).toBe('▶');
    });
  });
});
