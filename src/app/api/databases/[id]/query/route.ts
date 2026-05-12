import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/auth.config';
import { getDb } from '@/lib/db';
import { getQueryExecutor } from '@/lib/db/query-executor';
import { getDatabaseManager } from '@/lib/db/database-manager';

/**
 * POST /api/databases/[id]/query — Execute a SQL query
 *
 * Accepts { sql, database } in request body.
 * Executes the query via QueryExecutor, saves to query_history,
 * and returns the QueryResult with columns, rows, rowCount, truncated flag.
 *
 * Requirements: 5.2, 5.3, 5.4, 5.5, 5.6, 5.7
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = params;

  // Parse and validate request body
  let body: { sql?: string; database?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Invalid request body' },
      { status: 400 }
    );
  }

  const { sql, database } = body;

  if (!sql || typeof sql !== 'string' || sql.trim().length === 0) {
    return NextResponse.json(
      { error: 'SQL query is required' },
      { status: 400 }
    );
  }

  // Verify the connection exists
  const db = getDb();
  const connection = db.prepare(
    'SELECT id FROM database_connections WHERE id = ?'
  ).get(id) as { id: string } | undefined;

  if (!connection) {
    return NextResponse.json(
      { error: 'Database connection not found' },
      { status: 404 }
    );
  }

  // Execute query and save to history
  const startTime = Date.now();
  try {
    // Ensure connection is active (auto-connect if needed)
    const dbManager = getDatabaseManager();
    let activeConn = dbManager.getConnection(id);
    if (!activeConn || activeConn.status !== 'connected') {
      await dbManager.connect(id);
    }

    const queryExecutor = getQueryExecutor();
    const result = await queryExecutor.execute(id, sql, database);
    const executionTimeMs = Date.now() - startTime;

    // Save successful query to history
    db.prepare(
      `INSERT INTO query_history (connection_id, database_name, query_text, status, execution_time_ms, row_count)
       VALUES (?, ?, ?, 'success', ?, ?)`
    ).run(
      id,
      database || null,
      sql,
      executionTimeMs,
      result.rowCount ?? result.affectedRows ?? 0
    );

    return NextResponse.json(result);
  } catch (error: any) {
    const executionTimeMs = Date.now() - startTime;
    const errorMessage = error?.message || 'Query execution failed';

    // Save failed query to history
    db.prepare(
      `INSERT INTO query_history (connection_id, database_name, query_text, status, error_message, execution_time_ms)
       VALUES (?, ?, ?, 'error', ?, ?)`
    ).run(
      id,
      database || null,
      sql,
      errorMessage,
      executionTimeMs
    );

    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}
