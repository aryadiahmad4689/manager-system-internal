import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/auth.config';
import { getLogReader } from '@/lib/logs/log-reader';

/**
 * Validates a VM ID — must be non-empty hex characters only.
 */
function isValidVmId(id: string): boolean {
  return /^[a-f0-9]+$/i.test(id);
}

/**
 * Sanitizes a project name — prevents path traversal.
 * Returns null if the input is invalid.
 */
function sanitizeProject(project: string): string | null {
  if (!project || project.trim().length === 0) return null;
  if (project.includes('..') || project.includes('/') || project.includes('\\')) {
    return null;
  }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(project)) {
    return null;
  }
  return project;
}

/**
 * Sanitizes a log filename — must match CodeIgniter log filename pattern.
 * Returns null if the input is invalid.
 */
function sanitizeFilename(file: string): string | null {
  if (!file || file.trim().length === 0) return null;
  if (file.includes('..') || file.includes('/') || file.includes('\\')) {
    return null;
  }
  // Must match log-YYYY-MM-DD.php pattern
  if (!/^log-\d{4}-\d{2}-\d{2}\.php$/.test(file)) {
    return null;
  }
  return file;
}

/**
 * GET /api/vms/:id/logs/:project/:file — Read log file content
 */
export async function GET(
  _request: Request,
  { params }: { params: { id: string; project: string; file: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id, project, file } = params;

  if (!id || !isValidVmId(id)) {
    return NextResponse.json(
      { error: 'Invalid VM id format' },
      { status: 400 }
    );
  }

  const sanitizedProject = sanitizeProject(project);
  if (!sanitizedProject) {
    return NextResponse.json(
      { error: 'Invalid project name' },
      { status: 400 }
    );
  }

  const sanitizedFile = sanitizeFilename(file);
  if (!sanitizedFile) {
    return NextResponse.json(
      { error: 'Invalid log filename' },
      { status: 400 }
    );
  }

  try {
    const logReader = getLogReader();
    const entries = await logReader.readLogFile(id, sanitizedProject, sanitizedFile);
    return NextResponse.json(entries);
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to read log file' },
      { status: 500 }
    );
  }
}
