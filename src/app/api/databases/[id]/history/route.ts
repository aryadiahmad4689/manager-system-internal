import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/auth.config';
import { getDb } from '@/lib/db';

/**
 * GET /api/databases/[id]/history — Return query history for a connection
 *
 * Returns the most recent 100 query history entries for the given connection,
 * ordered by executed_at DESC. Auto-deletes oldest entries when count exceeds 100.
 *
 * Requirements: 6.1, 6.3, 6.4
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = params;

  const db = getDb();

  // Verify the connection exists
  const connection = db.prepare(
    'SELECT id FROM database_connections WHERE id = ?'
  ).get(id) as { id: string } | undefined;

  if (!connection) {
    return NextResponse.json(
      { error: 'Database connection not found' },
      { status: 404 }
    );
  }

  try {
    // Auto-delete oldest entries when count exceeds 100
    const countResult = db.prepare(
      'SELECT COUNT(*) as count FROM query_history WHERE connection_id = ?'
    ).get(id) as { count: number };

    if (countResult.count > 100) {
      // Delete entries beyond the 100 most recent
      db.prepare(
        `DELETE FROM query_history WHERE id NOT IN (
          SELECT id FROM query_history
          WHERE connection_id = ?
          ORDER BY executed_at DESC
          LIMIT 100
        ) AND connection_id = ?`
      ).run(id, id);
    }

    // Fetch the most recent 100 entries
    const history = db.prepare(
      `SELECT id, query_text, database_name, status, error_message, execution_time_ms, row_count, executed_at
       FROM query_history
       WHERE connection_id = ?
       ORDER BY executed_at DESC
       LIMIT 100`
    ).all(id) as Array<{
      id: string;
      query_text: string;
      database_name: string | null;
      status: string;
      error_message: string | null;
      execution_time_ms: number | null;
      row_count: number | null;
      executed_at: string;
    }>;

    // Map to camelCase response format
    const entries = history.map((row) => ({
      id: row.id,
      queryText: row.query_text,
      databaseName: row.database_name,
      status: row.status,
      errorMessage: row.error_message,
      executionTimeMs: row.execution_time_ms,
      rowCount: row.row_count,
      executedAt: row.executed_at,
    }));

    return NextResponse.json(entries);
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Failed to fetch query history' },
      { status: 500 }
    );
  }
}
