import { describe, it, expect } from 'vitest';
import {
  getStatusIndicator,
  getAvailableActions,
  formatDbType,
} from '@/components/db/connection-list-utils';
import type { ConnectionStatus } from '@/components/db/connection-list-utils';

describe('ConnectionList - getStatusIndicator', () => {
  it('should return green indicator for connected status', () => {
    const indicator = getStatusIndicator('connected');
    expect(indicator.color).toBe('green');
    expect(indicator.label).toBe('Connected');
    expect(indicator.dotClass).toBe('bg-green-500');
  });

  it('should return red indicator for disconnected status', () => {
    const indicator = getStatusIndicator('disconnected');
    expect(indicator.color).toBe('red');
    expect(indicator.label).toBe('Disconnected');
    expect(indicator.dotClass).toBe('bg-red-500');
  });

  it('should return yellow indicator for unreachable status', () => {
    const indicator = getStatusIndicator('unreachable');
    expect(indicator.color).toBe('yellow');
    expect(indicator.label).toBe('Unreachable');
    expect(indicator.dotClass).toBe('bg-yellow-500');
  });
});

describe('ConnectionList - getAvailableActions', () => {
  it('should allow disconnect but not connect when connected', () => {
    const actions = getAvailableActions('connected');
    expect(actions.canConnect).toBe(false);
    expect(actions.canDisconnect).toBe(true);
    expect(actions.canEdit).toBe(true);
    expect(actions.canDelete).toBe(true);
  });

  it('should allow connect but not disconnect when disconnected', () => {
    const actions = getAvailableActions('disconnected');
    expect(actions.canConnect).toBe(true);
    expect(actions.canDisconnect).toBe(false);
    expect(actions.canEdit).toBe(true);
    expect(actions.canDelete).toBe(true);
  });

  it('should allow connect but not disconnect when unreachable', () => {
    const actions = getAvailableActions('unreachable');
    expect(actions.canConnect).toBe(true);
    expect(actions.canDisconnect).toBe(false);
    expect(actions.canEdit).toBe(true);
    expect(actions.canDelete).toBe(true);
  });

  it('should always allow edit and delete regardless of status', () => {
    const statuses: ConnectionStatus[] = ['connected', 'disconnected', 'unreachable'];
    for (const status of statuses) {
      const actions = getAvailableActions(status);
      expect(actions.canEdit).toBe(true);
      expect(actions.canDelete).toBe(true);
    }
  });
});

describe('ConnectionList - formatDbType', () => {
  it('should format mysql as MySQL', () => {
    expect(formatDbType('mysql')).toBe('MySQL');
  });

  it('should format postgresql as PostgreSQL', () => {
    expect(formatDbType('postgresql')).toBe('PostgreSQL');
  });

  it('should format mariadb as MariaDB', () => {
    expect(formatDbType('mariadb')).toBe('MariaDB');
  });

  it('should handle case-insensitive input', () => {
    expect(formatDbType('MySQL')).toBe('MySQL');
    expect(formatDbType('POSTGRESQL')).toBe('PostgreSQL');
    expect(formatDbType('MariaDB')).toBe('MariaDB');
  });

  it('should return the input as-is for unknown types', () => {
    expect(formatDbType('sqlite')).toBe('sqlite');
    expect(formatDbType('oracle')).toBe('oracle');
  });
});
