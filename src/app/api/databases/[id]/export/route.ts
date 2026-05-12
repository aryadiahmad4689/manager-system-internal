import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/auth.config';
import { getCSVExporter } from '@/lib/db/csv-exporter';

/**
 * POST /api/databases/[id]/export — Export query results as CSV
 *
 * Accepts { columns, rows, database } in request body.
 * Generates CSV using CSVExporter and returns it as a downloadable file
 * with correct Content-Type and Content-Disposition headers.
 *
 * Requirements: 10.1, 10.2, 10.3, 10.4
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Parse and validate request body
  let body: { columns?: string[]; rows?: Record<string, any>[]; database?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Invalid request body' },
      { status: 400 }
    );
  }

  const { columns, rows, database } = body;

  if (!columns || !Array.isArray(columns) || columns.length === 0) {
    return NextResponse.json(
      { error: 'Columns are required and must be a non-empty array' },
      { status: 400 }
    );
  }

  if (!rows || !Array.isArray(rows)) {
    return NextResponse.json(
      { error: 'Rows are required and must be an array' },
      { status: 400 }
    );
  }

  const dbName = database || 'unknown';

  try {
    const csvExporter = getCSVExporter();
    const csvContent = csvExporter.export({ columns, rows, database: dbName });
    const filename = csvExporter.getFilename(dbName);

    return new NextResponse(csvContent, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Export failed' },
      { status: 500 }
    );
  }
}
