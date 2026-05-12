export type ConnectionStatus = 'connected' | 'disconnected' | 'unreachable';

export interface ConnectionItem {
  id: string;
  label?: string | null;
  dbType: string;
  host: string;
  port: number;
  username: string;
  status: ConnectionStatus;
}

export interface StatusIndicator {
  color: string;
  label: string;
  dotClass: string;
}

/**
 * Returns the visual indicator properties for a given connection status.
 * - connected: green
 * - disconnected: red
 * - unreachable: yellow
 */
export function getStatusIndicator(status: ConnectionStatus): StatusIndicator {
  switch (status) {
    case 'connected':
      return {
        color: 'green',
        label: 'Connected',
        dotClass: 'bg-green-500',
      };
    case 'disconnected':
      return {
        color: 'red',
        label: 'Disconnected',
        dotClass: 'bg-red-500',
      };
    case 'unreachable':
      return {
        color: 'yellow',
        label: 'Unreachable',
        dotClass: 'bg-yellow-500',
      };
  }
}

/**
 * Determines which actions are available for a connection based on its status.
 * - connected: can disconnect, edit, delete
 * - disconnected/unreachable: can connect, edit, delete
 */
export function getAvailableActions(status: ConnectionStatus): {
  canConnect: boolean;
  canDisconnect: boolean;
  canEdit: boolean;
  canDelete: boolean;
} {
  return {
    canConnect: status !== 'connected',
    canDisconnect: status === 'connected',
    canEdit: true,
    canDelete: true,
  };
}

/**
 * Formats the database type for display (capitalizes properly).
 */
export function formatDbType(dbType: string): string {
  switch (dbType.toLowerCase()) {
    case 'mysql':
      return 'MySQL';
    case 'postgresql':
      return 'PostgreSQL';
    case 'mariadb':
      return 'MariaDB';
    default:
      return dbType;
  }
}
