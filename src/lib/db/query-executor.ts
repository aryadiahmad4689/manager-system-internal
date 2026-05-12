import { getDatabaseManager, DatabaseConnection, DatabaseType } from './database-manager';

export interface QueryResult {
  columns: string[];
  rows: Record<string, any>[];
  rowCount: number;
  totalRows?: number;
  truncated: boolean;
  affectedRows?: number;
  executionTimeMs: number;
}

export interface ColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
  primaryKey: boolean;
  defaultValue: string | null;
}

export interface QueryExecutor {
  execute(connectionId: string, sql: string, database?: string): Promise<QueryResult>;
  getDatabases(connectionId: string): Promise<string[]>;
  getTables(connectionId: string, database: string): Promise<string[]>;
  getTableStructure(connectionId: string, database: string, table: string): Promise<ColumnInfo[]>;
}

const MAX_ROWS = 1000;

/**
 * Validates that the SQL string does not contain multiple statements.
 * Rejects queries containing `;` followed by non-whitespace characters.
 */
function validateSingleStatement(sql: string): void {
  const trimmed = sql.trim();
  // Find semicolons that are followed by non-whitespace content
  const semiIndex = trimmed.indexOf(';');
  if (semiIndex !== -1) {
    const afterSemi = trimmed.slice(semiIndex + 1);
    if (afterSemi.trim().length > 0) {
      throw new Error('Multiple statements are not allowed in a single execution');
    }
  }
}

/**
 * Determines if a SQL query is a SELECT-type statement (returns rows).
 */
function isSelectQuery(sql: string): boolean {
  const normalized = sql.trim().toUpperCase();
  return (
    normalized.startsWith('SELECT') ||
    normalized.startsWith('SHOW') ||
    normalized.startsWith('DESCRIBE') ||
    normalized.startsWith('EXPLAIN')
  );
}

/**
 * Query Executor implementation.
 *
 * Executes SQL queries against active database connections,
 * handles result formatting, row limiting, and schema introspection.
 */
export class QueryExecutorImpl implements QueryExecutor {
  /**
   * Executes a SQL query on the specified connection.
   *
   * - Limits SELECT results to 1000 rows
   * - Measures execution time
   * - Tracks affected rows for INSERT/UPDATE/DELETE
   * - Prevents multiple statements
   * - Returns raw database error messages
   */
  async execute(connectionId: string, sql: string, database?: string): Promise<QueryResult> {
    validateSingleStatement(sql);

    const connection = this.getActiveConnection(connectionId);
    const dbType = connection.config.dbType;

    const startTime = Date.now();

    try {
      if (dbType === 'mysql' || dbType === 'mariadb') {
        return await this.executeMysql(connection, sql, database, startTime);
      } else {
        return await this.executePostgresql(connection, sql, database, startTime);
      }
    } catch (err: any) {
      // Return raw database error messages without modification
      throw err;
    }
  }

  /**
   * Returns a list of databases available on the server.
   */
  async getDatabases(connectionId: string): Promise<string[]> {
    const connection = this.getActiveConnection(connectionId);
    const dbType = connection.config.dbType;

    if (dbType === 'mysql' || dbType === 'mariadb') {
      const [rows] = await connection.client.query('SHOW DATABASES');
      return (rows as any[]).map((row: any) => row.Database);
    } else {
      const result = await connection.client.query(
        'SELECT datname FROM pg_database WHERE datistemplate = false'
      );
      return result.rows.map((row: any) => row.datname);
    }
  }

  /**
   * Returns a list of tables in the specified database.
   */
  async getTables(connectionId: string, database: string): Promise<string[]> {
    const connection = this.getActiveConnection(connectionId);
    const dbType = connection.config.dbType;

    if (dbType === 'mysql' || dbType === 'mariadb') {
      const [rows] = await connection.client.query(`SHOW TABLES FROM \`${database}\``);
      // SHOW TABLES returns rows with a dynamic field name like "Tables_in_<database>"
      return (rows as any[]).map((row: any) => Object.values(row)[0] as string);
    } else {
      const result = await connection.client.query(
        "SELECT tablename FROM pg_tables WHERE schemaname = 'public'"
      );
      return result.rows.map((row: any) => row.tablename);
    }
  }

  /**
   * Returns column information for a specific table.
   */
  async getTableStructure(
    connectionId: string,
    database: string,
    table: string
  ): Promise<ColumnInfo[]> {
    const connection = this.getActiveConnection(connectionId);
    const dbType = connection.config.dbType;

    if (dbType === 'mysql' || dbType === 'mariadb') {
      return await this.getMysqlTableStructure(connection, database, table);
    } else {
      return await this.getPostgresqlTableStructure(connection, database, table);
    }
  }

  /**
   * Retrieves the active connection or throws if not found.
   */
  private getActiveConnection(connectionId: string): DatabaseConnection {
    const manager = getDatabaseManager();
    const connection = manager.getConnection(connectionId);
    if (!connection) {
      throw new Error(`No active connection found for: ${connectionId}`);
    }
    if (connection.status !== 'connected') {
      throw new Error(`Connection is not active: ${connectionId}`);
    }
    return connection;
  }

  /**
   * Executes a query on a MySQL/MariaDB connection.
   */
  private async executeMysql(
    connection: DatabaseConnection,
    sql: string,
    database: string | undefined,
    startTime: number
  ): Promise<QueryResult> {
    // Switch database if specified
    if (database) {
      await connection.client.query(`USE \`${database}\``);
    }

    const [rows, fields] = await connection.client.query(sql);
    const executionTimeMs = Date.now() - startTime;

    if (isSelectQuery(sql)) {
      const allRows = rows as any[];
      const totalRows = allRows.length;
      const truncated = totalRows > MAX_ROWS;
      const limitedRows = truncated ? allRows.slice(0, MAX_ROWS) : allRows;
      const columns = fields
        ? (fields as any[]).map((f: any) => f.name)
        : limitedRows.length > 0
          ? Object.keys(limitedRows[0])
          : [];

      return {
        columns,
        rows: limitedRows,
        rowCount: limitedRows.length,
        totalRows: truncated ? totalRows : undefined,
        truncated,
        executionTimeMs,
      };
    } else {
      // INSERT/UPDATE/DELETE - rows is a ResultSetHeader
      const result = rows as any;
      return {
        columns: [],
        rows: [],
        rowCount: 0,
        truncated: false,
        affectedRows: result.affectedRows ?? 0,
        executionTimeMs,
      };
    }
  }

  /**
   * Executes a query on a PostgreSQL connection.
   */
  private async executePostgresql(
    connection: DatabaseConnection,
    sql: string,
    database: string | undefined,
    startTime: number
  ): Promise<QueryResult> {
    // PostgreSQL doesn't support USE; database is set at connection time.
    // If a different database is specified, we note it but pg doesn't switch dynamically.
    // The caller should ensure the connection is to the correct database.
    if (database) {
      await connection.client.query(`SET search_path TO public`);
    }

    const result = await connection.client.query(sql);
    const executionTimeMs = Date.now() - startTime;

    if (isSelectQuery(sql)) {
      const allRows = result.rows as any[];
      const totalRows = allRows.length;
      const truncated = totalRows > MAX_ROWS;
      const limitedRows = truncated ? allRows.slice(0, MAX_ROWS) : allRows;
      const columns = result.fields
        ? result.fields.map((f: any) => f.name)
        : limitedRows.length > 0
          ? Object.keys(limitedRows[0])
          : [];

      return {
        columns,
        rows: limitedRows,
        rowCount: limitedRows.length,
        totalRows: truncated ? totalRows : undefined,
        truncated,
        executionTimeMs,
      };
    } else {
      return {
        columns: [],
        rows: [],
        rowCount: 0,
        truncated: false,
        affectedRows: result.rowCount ?? 0,
        executionTimeMs,
      };
    }
  }

  /**
   * Gets table structure for MySQL/MariaDB using SHOW COLUMNS.
   */
  private async getMysqlTableStructure(
    connection: DatabaseConnection,
    database: string,
    table: string
  ): Promise<ColumnInfo[]> {
    const [rows] = await connection.client.query(
      `SHOW COLUMNS FROM \`${table}\` FROM \`${database}\``
    );

    return (rows as any[]).map((row: any) => ({
      name: row.Field,
      type: row.Type,
      nullable: row.Null === 'YES',
      primaryKey: row.Key === 'PRI',
      defaultValue: row.Default ?? null,
    }));
  }

  /**
   * Gets table structure for PostgreSQL using information_schema.
   */
  private async getPostgresqlTableStructure(
    connection: DatabaseConnection,
    database: string,
    table: string
  ): Promise<ColumnInfo[]> {
    // Get column info
    const columnsResult = await connection.client.query(
      `SELECT column_name, data_type, is_nullable, column_default
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1
       ORDER BY ordinal_position`,
      [table]
    );

    // Get primary key columns
    const pkResult = await connection.client.query(
      `SELECT kcu.column_name
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON tc.constraint_name = kcu.constraint_name
         AND tc.table_schema = kcu.table_schema
       WHERE tc.constraint_type = 'PRIMARY KEY'
         AND tc.table_schema = 'public'
         AND tc.table_name = $1`,
      [table]
    );

    const primaryKeyColumns = new Set(
      pkResult.rows.map((row: any) => row.column_name)
    );

    return columnsResult.rows.map((row: any) => ({
      name: row.column_name,
      type: row.data_type,
      nullable: row.is_nullable === 'YES',
      primaryKey: primaryKeyColumns.has(row.column_name),
      defaultValue: row.column_default ?? null,
    }));
  }
}

/**
 * Singleton Query Executor instance.
 */
let queryExecutorInstance: QueryExecutorImpl | null = null;

/**
 * Returns the singleton Query Executor instance.
 */
export function getQueryExecutor(): QueryExecutorImpl {
  if (!queryExecutorInstance) {
    queryExecutorInstance = new QueryExecutorImpl();
  }
  return queryExecutorInstance;
}

/**
 * Resets the singleton Query Executor (useful for testing).
 */
export function resetQueryExecutor(): void {
  queryExecutorInstance = null;
}

/**
 * Creates a new Query Executor instance (useful for testing).
 */
export function createQueryExecutor(): QueryExecutorImpl {
  return new QueryExecutorImpl();
}
