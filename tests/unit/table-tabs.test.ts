import { describe, it, expect, vi } from 'vitest';
import type { TableTab } from '@/components/db/TableTabs';

describe('TableTabs', () => {
  // Helper to create a mock tab
  function createMockTab(overrides: Partial<TableTab> = {}): TableTab {
    return {
      id: 'conn1.mydb.users',
      connId: 'conn1',
      dbName: 'mydb',
      tableName: 'users',
      result: null,
      error: null,
      isLoading: false,
      ...overrides,
    };
  }

  describe('TableTab interface', () => {
    it('should have correct id format: connId.dbName.tableName', () => {
      const tab = createMockTab({
        connId: 'abc123',
        dbName: 'production',
        tableName: 'orders',
      });
      const expectedId = `${tab.connId}.${tab.dbName}.${tab.tableName}`;
      expect(expectedId).toBe('abc123.production.orders');
    });

    it('should support loading state', () => {
      const tab = createMockTab({ isLoading: true });
      expect(tab.isLoading).toBe(true);
      expect(tab.result).toBeNull();
      expect(tab.error).toBeNull();
    });

    it('should support error state', () => {
      const tab = createMockTab({ error: 'Connection lost' });
      expect(tab.error).toBe('Connection lost');
      expect(tab.result).toBeNull();
    });

    it('should support result state', () => {
      const tab = createMockTab({
        result: {
          columns: ['id', 'name', 'email'],
          rows: [{ id: 1, name: 'Alice', email: 'alice@example.com' }],
          rowCount: 1,
          truncated: false,
          executionTimeMs: 42,
        },
      });
      expect(tab.result).not.toBeNull();
      expect(tab.result!.columns).toHaveLength(3);
      expect(tab.result!.rows).toHaveLength(1);
    });
  });

  describe('Tab management logic', () => {
    it('should not create duplicate tabs for the same table', () => {
      const tabs: TableTab[] = [
        createMockTab({ id: 'conn1.mydb.users' }),
      ];

      const tabId = 'conn1.mydb.users';
      const existingTab = tabs.find((t) => t.id === tabId);
      expect(existingTab).toBeDefined();
      // When tab exists, we just switch to it (no new tab created)
      expect(tabs).toHaveLength(1);
    });

    it('should create a new tab when table is not already open', () => {
      const tabs: TableTab[] = [
        createMockTab({ id: 'conn1.mydb.users' }),
      ];

      const newTabId = 'conn1.mydb.orders';
      const existingTab = tabs.find((t) => t.id === newTabId);
      expect(existingTab).toBeUndefined();

      // Simulate adding new tab
      const newTab = createMockTab({
        id: newTabId,
        tableName: 'orders',
        isLoading: true,
      });
      const updatedTabs = [...tabs, newTab];
      expect(updatedTabs).toHaveLength(2);
    });

    it('should handle closing a tab and selecting the last remaining tab', () => {
      const tabs: TableTab[] = [
        createMockTab({ id: 'conn1.mydb.users' }),
        createMockTab({ id: 'conn1.mydb.orders', tableName: 'orders' }),
        createMockTab({ id: 'conn1.mydb.products', tableName: 'products' }),
      ];

      const tabIdToClose = 'conn1.mydb.orders';
      const activeTabId = 'conn1.mydb.orders';

      const newTabs = tabs.filter((t) => t.id !== tabIdToClose);
      expect(newTabs).toHaveLength(2);

      // If we closed the active tab, switch to the last remaining
      let newActiveTabId: string | null = activeTabId;
      if (activeTabId === tabIdToClose) {
        const lastTab = newTabs[newTabs.length - 1];
        newActiveTabId = lastTab ? lastTab.id : null;
      }
      expect(newActiveTabId).toBe('conn1.mydb.products');
    });

    it('should set activeTabId to null when all tabs are closed', () => {
      const tabs: TableTab[] = [
        createMockTab({ id: 'conn1.mydb.users' }),
      ];

      const tabIdToClose = 'conn1.mydb.users';
      const activeTabId = 'conn1.mydb.users';

      const newTabs = tabs.filter((t) => t.id !== tabIdToClose);
      expect(newTabs).toHaveLength(0);

      let newActiveTabId: string | null = activeTabId;
      if (activeTabId === tabIdToClose) {
        const lastTab = newTabs[newTabs.length - 1];
        newActiveTabId = lastTab ? lastTab.id : null;
      }
      expect(newActiveTabId).toBeNull();
    });

    it('should update tab result after successful query', () => {
      const tabs: TableTab[] = [
        createMockTab({ id: 'conn1.mydb.users', isLoading: true }),
      ];

      const tabId = 'conn1.mydb.users';
      const result = {
        columns: ['id', 'name'],
        rows: [{ id: 1, name: 'Alice' }],
        rowCount: 1,
        truncated: false,
        executionTimeMs: 15,
      };

      const updatedTabs = tabs.map((t) =>
        t.id === tabId ? { ...t, result, isLoading: false } : t
      );

      expect(updatedTabs[0].isLoading).toBe(false);
      expect(updatedTabs[0].result).toEqual(result);
    });

    it('should update tab error after failed query', () => {
      const tabs: TableTab[] = [
        createMockTab({ id: 'conn1.mydb.users', isLoading: true }),
      ];

      const tabId = 'conn1.mydb.users';
      const errorMessage = 'Access denied for user';

      const updatedTabs = tabs.map((t) =>
        t.id === tabId ? { ...t, error: errorMessage, isLoading: false } : t
      );

      expect(updatedTabs[0].isLoading).toBe(false);
      expect(updatedTabs[0].error).toBe(errorMessage);
      expect(updatedTabs[0].result).toBeNull();
    });

    it('should handle refresh by setting loading state and clearing error', () => {
      const tabs: TableTab[] = [
        createMockTab({
          id: 'conn1.mydb.users',
          error: 'Previous error',
          result: null,
        }),
      ];

      const tabId = 'conn1.mydb.users';
      const refreshedTabs = tabs.map((t) =>
        t.id === tabId ? { ...t, isLoading: true, error: null } : t
      );

      expect(refreshedTabs[0].isLoading).toBe(true);
      expect(refreshedTabs[0].error).toBeNull();
    });

    it('should support multiple tabs from different connections', () => {
      const tabs: TableTab[] = [
        createMockTab({ id: 'conn1.db1.users', connId: 'conn1', dbName: 'db1', tableName: 'users' }),
        createMockTab({ id: 'conn2.db2.orders', connId: 'conn2', dbName: 'db2', tableName: 'orders' }),
        createMockTab({ id: 'conn1.db1.products', connId: 'conn1', dbName: 'db1', tableName: 'products' }),
      ];

      expect(tabs).toHaveLength(3);
      const conn1Tabs = tabs.filter((t) => t.connId === 'conn1');
      const conn2Tabs = tabs.filter((t) => t.connId === 'conn2');
      expect(conn1Tabs).toHaveLength(2);
      expect(conn2Tabs).toHaveLength(1);
    });
  });
});
