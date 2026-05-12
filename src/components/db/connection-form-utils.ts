export type DatabaseType = 'mysql' | 'postgresql' | 'mariadb';

export interface VMOption {
  id: string;
  label: string;
}

export interface ConnectionFormData {
  dbType: DatabaseType;
  host: string;
  port: number;
  username: string;
  password: string;
}

export interface ConnectionFormInitialData {
  dbType: DatabaseType;
  host: string;
  port: number;
  username: string;
}

export interface FieldErrors {
  dbType?: string;
  host?: string;
  port?: string;
  username?: string;
  password?: string;
}

export const DEFAULT_PORTS: Record<DatabaseType, number> = {
  mysql: 3306,
  postgresql: 5432,
  mariadb: 3306,
};

export const DB_TYPE_LABELS: Record<DatabaseType, string> = {
  mysql: 'MySQL',
  postgresql: 'PostgreSQL',
  mariadb: 'MariaDB',
};

export function getDefaultPort(dbType: DatabaseType): number {
  return DEFAULT_PORTS[dbType];
}

export function validateConnectionForm(
  data: {
    dbType: string;
    host: string;
    port: string;
    username: string;
    password: string;
  },
  isEditMode: boolean
): FieldErrors {
  const errors: FieldErrors = {};

  if (!data.dbType) {
    errors.dbType = 'Database type is required';
  }

  if (!data.host.trim()) {
    errors.host = 'Host is required';
  }

  const portNum = parseInt(data.port, 10);
  if (!data.port) {
    errors.port = 'Port is required';
  } else if (isNaN(portNum)) {
    errors.port = 'Port must be a number';
  } else if (portNum < 1 || portNum > 65535) {
    errors.port = 'Port must be between 1 and 65535';
  }

  if (!data.username.trim()) {
    errors.username = 'Username is required';
  }

  if (!isEditMode && !data.password) {
    errors.password = 'Password is required';
  }

  return errors;
}
