import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock next-auth before importing routes
vi.mock('next-auth', () => ({
  default: vi.fn(),
  getServerSession: vi.fn(),
}));

// Mock the log-reader module
vi.mock('@/lib/logs/log-reader', () => ({
  getLogReader: vi.fn(),
}));

// Mock auth config
vi.mock('@/lib/auth/auth.config', () => ({
  authOptions: {},
}));

import { getServerSession } from 'next-auth';
import { getLogReader } from '@/lib/logs/log-reader';
import { GET as GET_PROJECTS } from '@/app/api/vms/[id]/projects/route';
import { GET as GET_LOG_FILES } from '@/app/api/vms/[id]/logs/[project]/route';
import { GET as GET_LOG_CONTENT } from '@/app/api/vms/[id]/logs/[project]/[file]/route';
import { GET as GET_SEARCH } from '@/app/api/vms/[id]/logs/[project]/search/route';

const mockGetServerSession = vi.mocked(getServerSession);
const mockGetLogReader = vi.mocked(getLogReader);

const mockLogReader = {
  listProjects: vi.fn(),
  listLogFiles: vi.fn(),
  readLogFile: vi.fn(),
  searchLogs: vi.fn(),
};

describe('Log API Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetLogReader.mockReturnValue(mockLogReader as any);
  });

  describe('GET /api/vms/:id/projects', () => {
    it('should return 401 when not authenticated', async () => {
      mockGetServerSession.mockResolvedValue(null);

      const response = await GET_PROJECTS(
        new Request('http://localhost/api/vms/abc123/projects'),
        { params: { id: 'abc123' } }
      );
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body.error).toBe('Unauthorized');
    });

    it('should return 400 for invalid VM id format', async () => {
      mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });

      const response = await GET_PROJECTS(
        new Request('http://localhost/api/vms/invalid!@#/projects'),
        { params: { id: 'invalid!@#' } }
      );
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toBe('Invalid VM id format');
    });

    it('should return projects list when authenticated', async () => {
      mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });
      const mockProjects = [
        { name: 'myapp', path: '/var/www/html/myapp', logCount: 5 },
        { name: 'api-service', path: '/var/www/html/api-service', logCount: 3 },
      ];
      mockLogReader.listProjects.mockResolvedValue(mockProjects);

      const response = await GET_PROJECTS(
        new Request('http://localhost/api/vms/abc123def456/projects'),
        { params: { id: 'abc123def456' } }
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toHaveLength(2);
      expect(body[0].name).toBe('myapp');
      expect(body[1].name).toBe('api-service');
    });

    it('should return 500 when listProjects throws', async () => {
      mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });
      mockLogReader.listProjects.mockRejectedValue(new Error('SSH connection failed'));

      const response = await GET_PROJECTS(
        new Request('http://localhost/api/vms/abc123/projects'),
        { params: { id: 'abc123' } }
      );
      const body = await response.json();

      expect(response.status).toBe(500);
      expect(body.error).toBe('Failed to retrieve projects');
    });
  });

  describe('GET /api/vms/:id/logs/:project', () => {
    it('should return 401 when not authenticated', async () => {
      mockGetServerSession.mockResolvedValue(null);

      const response = await GET_LOG_FILES(
        new Request('http://localhost/api/vms/abc123/logs/myapp'),
        { params: { id: 'abc123', project: 'myapp' } }
      );
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body.error).toBe('Unauthorized');
    });

    it('should return 400 for invalid VM id', async () => {
      mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });

      const response = await GET_LOG_FILES(
        new Request('http://localhost/api/vms/bad-id!/logs/myapp'),
        { params: { id: 'bad-id!', project: 'myapp' } }
      );
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toBe('Invalid VM id format');
    });

    it('should return 400 for project with path traversal', async () => {
      mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });

      const response = await GET_LOG_FILES(
        new Request('http://localhost/api/vms/abc123/logs/../etc'),
        { params: { id: 'abc123', project: '../etc' } }
      );
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toBe('Invalid project name');
    });

    it('should return 400 for project with slashes', async () => {
      mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });

      const response = await GET_LOG_FILES(
        new Request('http://localhost/api/vms/abc123/logs/foo/bar'),
        { params: { id: 'abc123', project: 'foo/bar' } }
      );
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toBe('Invalid project name');
    });

    it('should return 400 for project starting with dot', async () => {
      mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });

      const response = await GET_LOG_FILES(
        new Request('http://localhost/api/vms/abc123/logs/.hidden'),
        { params: { id: 'abc123', project: '.hidden' } }
      );
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toBe('Invalid project name');
    });

    it('should return log files list when valid', async () => {
      mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });
      const mockFiles = [
        { filename: 'log-2024-01-15.php', date: '2024-01-15', size: 1024 },
        { filename: 'log-2024-01-14.php', date: '2024-01-14', size: 2048 },
      ];
      mockLogReader.listLogFiles.mockResolvedValue(mockFiles);

      const response = await GET_LOG_FILES(
        new Request('http://localhost/api/vms/abc123/logs/myapp'),
        { params: { id: 'abc123', project: 'myapp' } }
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toHaveLength(2);
      expect(body[0].filename).toBe('log-2024-01-15.php');
    });

    it('should return 500 when listLogFiles throws', async () => {
      mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });
      mockLogReader.listLogFiles.mockRejectedValue(new Error('SSH error'));

      const response = await GET_LOG_FILES(
        new Request('http://localhost/api/vms/abc123/logs/myapp'),
        { params: { id: 'abc123', project: 'myapp' } }
      );
      const body = await response.json();

      expect(response.status).toBe(500);
      expect(body.error).toBe('Failed to retrieve log files');
    });
  });

  describe('GET /api/vms/:id/logs/:project/:file', () => {
    it('should return 401 when not authenticated', async () => {
      mockGetServerSession.mockResolvedValue(null);

      const response = await GET_LOG_CONTENT(
        new Request('http://localhost/api/vms/abc123/logs/myapp/log-2024-01-15.php'),
        { params: { id: 'abc123', project: 'myapp', file: 'log-2024-01-15.php' } }
      );
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body.error).toBe('Unauthorized');
    });

    it('should return 400 for invalid VM id', async () => {
      mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });

      const response = await GET_LOG_CONTENT(
        new Request('http://localhost/api/vms/xyz!/logs/myapp/log-2024-01-15.php'),
        { params: { id: 'xyz!', project: 'myapp', file: 'log-2024-01-15.php' } }
      );
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toBe('Invalid VM id format');
    });

    it('should return 400 for invalid project name', async () => {
      mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });

      const response = await GET_LOG_CONTENT(
        new Request('http://localhost/api/vms/abc123/logs/../etc/log-2024-01-15.php'),
        { params: { id: 'abc123', project: '../etc', file: 'log-2024-01-15.php' } }
      );
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toBe('Invalid project name');
    });

    it('should return 400 for invalid filename format', async () => {
      mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });

      const response = await GET_LOG_CONTENT(
        new Request('http://localhost/api/vms/abc123/logs/myapp/malicious.txt'),
        { params: { id: 'abc123', project: 'myapp', file: 'malicious.txt' } }
      );
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toBe('Invalid log filename');
    });

    it('should return 400 for filename with path traversal', async () => {
      mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });

      const response = await GET_LOG_CONTENT(
        new Request('http://localhost/api/vms/abc123/logs/myapp/../../etc/passwd'),
        { params: { id: 'abc123', project: 'myapp', file: '../../etc/passwd' } }
      );
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toBe('Invalid log filename');
    });

    it('should return log entries when valid', async () => {
      mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });
      const mockEntries = [
        { level: 'ERROR', timestamp: '2024-01-15 10:23:45', message: 'Something failed', raw: 'ERROR - 2024-01-15 10:23:45 --> Something failed' },
        { level: 'INFO', timestamp: '2024-01-15 10:23:46', message: 'Request processed', raw: 'INFO  - 2024-01-15 10:23:46 --> Request processed' },
      ];
      mockLogReader.readLogFile.mockResolvedValue(mockEntries);

      const response = await GET_LOG_CONTENT(
        new Request('http://localhost/api/vms/abc123/logs/myapp/log-2024-01-15.php'),
        { params: { id: 'abc123', project: 'myapp', file: 'log-2024-01-15.php' } }
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toHaveLength(2);
      expect(body[0].level).toBe('ERROR');
      expect(body[1].level).toBe('INFO');
    });

    it('should return 500 when readLogFile throws', async () => {
      mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });
      mockLogReader.readLogFile.mockRejectedValue(new Error('File not found'));

      const response = await GET_LOG_CONTENT(
        new Request('http://localhost/api/vms/abc123/logs/myapp/log-2024-01-15.php'),
        { params: { id: 'abc123', project: 'myapp', file: 'log-2024-01-15.php' } }
      );
      const body = await response.json();

      expect(response.status).toBe(500);
      expect(body.error).toBe('Failed to read log file');
    });
  });

  describe('GET /api/vms/:id/logs/:project/search', () => {
    it('should return 401 when not authenticated', async () => {
      mockGetServerSession.mockResolvedValue(null);

      const response = await GET_SEARCH(
        new Request('http://localhost/api/vms/abc123/logs/myapp/search?q=error'),
        { params: { id: 'abc123', project: 'myapp' } }
      );
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body.error).toBe('Unauthorized');
    });

    it('should return 400 for invalid VM id', async () => {
      mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });

      const response = await GET_SEARCH(
        new Request('http://localhost/api/vms/bad!/logs/myapp/search?q=error'),
        { params: { id: 'bad!', project: 'myapp' } }
      );
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toBe('Invalid VM id format');
    });

    it('should return 400 for invalid project name', async () => {
      mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });

      const response = await GET_SEARCH(
        new Request('http://localhost/api/vms/abc123/logs/../etc/search?q=error'),
        { params: { id: 'abc123', project: '../etc' } }
      );
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toBe('Invalid project name');
    });

    it('should return 400 when query parameter is missing', async () => {
      mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });

      const response = await GET_SEARCH(
        new Request('http://localhost/api/vms/abc123/logs/myapp/search'),
        { params: { id: 'abc123', project: 'myapp' } }
      );
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toContain('query parameter');
    });

    it('should return 400 when query parameter is empty', async () => {
      mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });

      const response = await GET_SEARCH(
        new Request('http://localhost/api/vms/abc123/logs/myapp/search?q='),
        { params: { id: 'abc123', project: 'myapp' } }
      );
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toContain('query parameter');
    });

    it('should return search results when valid', async () => {
      mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });
      const mockResults = [
        { level: 'ERROR', timestamp: '2024-01-15 10:23:45', message: 'Database error occurred', raw: 'ERROR - 2024-01-15 10:23:45 --> Database error occurred' },
      ];
      mockLogReader.searchLogs.mockResolvedValue(mockResults);

      const response = await GET_SEARCH(
        new Request('http://localhost/api/vms/abc123/logs/myapp/search?q=database'),
        { params: { id: 'abc123', project: 'myapp' } }
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toHaveLength(1);
      expect(body[0].message).toContain('Database');
      expect(mockLogReader.searchLogs).toHaveBeenCalledWith('abc123', 'myapp', 'database', undefined);
    });

    it('should pass optional file parameter to searchLogs', async () => {
      mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });
      mockLogReader.searchLogs.mockResolvedValue([]);

      const response = await GET_SEARCH(
        new Request('http://localhost/api/vms/abc123/logs/myapp/search?q=error&file=log-2024-01-15.php'),
        { params: { id: 'abc123', project: 'myapp' } }
      );

      expect(response.status).toBe(200);
      expect(mockLogReader.searchLogs).toHaveBeenCalledWith('abc123', 'myapp', 'error', 'log-2024-01-15.php');
    });

    it('should return 500 when searchLogs throws', async () => {
      mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });
      mockLogReader.searchLogs.mockRejectedValue(new Error('SSH timeout'));

      const response = await GET_SEARCH(
        new Request('http://localhost/api/vms/abc123/logs/myapp/search?q=error'),
        { params: { id: 'abc123', project: 'myapp' } }
      );
      const body = await response.json();

      expect(response.status).toBe(500);
      expect(body.error).toBe('Failed to search logs');
    });
  });
});
