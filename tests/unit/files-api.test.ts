import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next-auth', () => ({
  default: vi.fn(),
  getServerSession: vi.fn(),
}));

vi.mock('@/lib/auth/auth.config', () => ({
  authOptions: {},
}));

vi.mock('@/lib/ssh/ssh-manager', () => ({
  getSSHManager: vi.fn(),
}));

import { getServerSession } from 'next-auth';
import { getSSHManager } from '@/lib/ssh/ssh-manager';
import { GET as GET_FILES_LIST, isConfigFile, isCodeFile } from '@/app/api/vms/[id]/files/list/route';
import { GET as GET_FILE_READ } from '@/app/api/vms/[id]/files/read/route';
import { POST as POST_FILE_SAVE } from '@/app/api/vms/[id]/files/save/route';

const mockGetServerSession = vi.mocked(getServerSession);
const mockGetSSHManager = vi.mocked(getSSHManager);

describe('Files API (List, Read, Save)', () => {
  const mockExecute = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSSHManager.mockReturnValue({
      executeCommand: mockExecute,
    } as any);
  });

  describe('isConfigFile & isCodeFile helpers', () => {
    it('should identify environment and config files correctly', () => {
      expect(isConfigFile('.env')).toBe(true);
      expect(isConfigFile('.env.local')).toBe(true);
      expect(isConfigFile('.env.production')).toBe(true);
      expect(isConfigFile('config.yaml')).toBe(true);
      expect(isConfigFile('application.yml')).toBe(true);
      expect(isConfigFile('package.json')).toBe(true);
      expect(isConfigFile('nginx.conf')).toBe(true);
      expect(isConfigFile('my-service.service')).toBe(true);
      expect(isConfigFile('Cargo.toml')).toBe(true);
      expect(isConfigFile('php.ini')).toBe(true);

      expect(isConfigFile('app.js')).toBe(false);
      expect(isConfigFile('main.py')).toBe(false);
      expect(isConfigFile('image.png')).toBe(false);
      expect(isConfigFile('server.bin')).toBe(false);
    });

    it('should identify code files including .go, Dockerfile, etc.', () => {
      expect(isCodeFile('main.go')).toBe(true);
      expect(isCodeFile('service.go')).toBe(true);
      expect(isCodeFile('Dockerfile')).toBe(true);
      expect(isCodeFile('go.mod')).toBe(true);
      expect(isCodeFile('go.sum')).toBe(true);
      expect(isCodeFile('script.sh')).toBe(true);
      expect(isCodeFile('app.ts')).toBe(true);
      expect(isCodeFile('server.js')).toBe(true);

      expect(isCodeFile('data.csv')).toBe(false);
      expect(isCodeFile('archive.tar.gz')).toBe(false);
    });
  });

  describe('GET /api/vms/:id/files/list', () => {
    it('should return 401 if unauthenticated', async () => {
      mockGetServerSession.mockResolvedValue(null);
      const req = new Request('http://localhost/api/vms/vm-1/files/list?dir=/var/www');
      const res = await GET_FILES_LIST(req, { params: { id: 'vm-1' } });
      expect(res.status).toBe(401);
    });

    it('should return 400 for invalid VM ID format', async () => {
      mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });
      const req = new Request('http://localhost/api/vms/vm;bad/files/list?dir=/var/www');
      const res = await GET_FILES_LIST(req, { params: { id: 'vm;bad' } });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain('Invalid VM id');
    });

    it('should return 400 if dir parameter is missing', async () => {
      mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });
      const req = new Request('http://localhost/api/vms/vm-1/files/list');
      const res = await GET_FILES_LIST(req, { params: { id: 'vm-1' } });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain('dir parameter is required');
    });

    it('should list files, prioritize configs, identify dirs, and filter noisy folders', async () => {
      mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });
      mockExecute.mockResolvedValue(`
.env.production
node_modules/
.git/
vendor/
src/
config.yaml
server.js
package.json
public/
README.md
      `.trim());

      const req = new Request('http://localhost/api/vms/vm-1/files/list?dir=/var/www/app');
      const res = await GET_FILES_LIST(req, { params: { id: 'vm-1' } });
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.dir).toBe('/var/www/app');
      expect(Array.isArray(data.files)).toBe(true);

      const fileNames = data.files.map((f: any) => f.name);
      // node_modules, .git, vendor should be filtered out
      expect(fileNames).not.toContain('node_modules');
      expect(fileNames).not.toContain('.git');
      expect(fileNames).not.toContain('vendor');

      // Config files should come first
      const firstConfigs = data.files.slice(0, 3).map((f: any) => f.name);
      expect(firstConfigs).toContain('.env.production');
      expect(firstConfigs).toContain('config.yaml');
      expect(firstConfigs).toContain('package.json');

      const envFile = data.files.find((f: any) => f.name === '.env.production');
      expect(envFile.isConfig).toBe(true);
      expect(envFile.isDir).toBe(false);
      expect(envFile.path).toBe('/var/www/app/.env.production');

      const srcDir = data.files.find((f: any) => f.name === 'src');
      expect(srcDir.isDir).toBe(true);
      expect(srcDir.path).toBe('/var/www/app/src');
    });

    it('should support recursive discovery for .go and subfolder files', async () => {
      mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });
      mockExecute.mockResolvedValue(`
/var/www/app/config.json
/var/www/app/internal/auth/auth.go
/var/www/app/internal/handler/service.go
/var/www/app/middleware/jwt.go
/var/www/app/main.go
      `.trim());

      const req = new Request('http://localhost/api/vms/vm-1/files/list?dir=/var/www/app&recursive=true&search=.go');
      const res = await GET_FILES_LIST(req, { params: { id: 'vm-1' } });
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.isRecursive).toBe(true);
      expect(data.files.length).toBe(5);

      const authGo = data.files.find((f: any) => f.name === 'internal/auth/auth.go');
      expect(authGo).toBeDefined();
      expect(authGo.isCode).toBe(true);
      expect(authGo.path).toBe('/var/www/app/internal/auth/auth.go');
    });
  });

  describe('GET /api/vms/:id/files/read', () => {
    it('should return 401 if unauthenticated', async () => {
      mockGetServerSession.mockResolvedValue(null);
      const req = new Request('http://localhost/api/vms/vm-1/files/read?path=/var/www/.env');
      const res = await GET_FILE_READ(req, { params: { id: 'vm-1' } });
      expect(res.status).toBe(401);
    });

    it('should return 400 if path is missing', async () => {
      mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });
      const req = new Request('http://localhost/api/vms/vm-1/files/read');
      const res = await GET_FILE_READ(req, { params: { id: 'vm-1' } });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain('path parameter is required');
    });

    it('should return 413 if file exceeds MAX_FILE_SIZE (2MB)', async () => {
      mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });
      // Return size > 2MB
      mockExecute.mockResolvedValueOnce('3000000');

      const req = new Request('http://localhost/api/vms/vm-1/files/read?path=/var/log/huge.log');
      const res = await GET_FILE_READ(req, { params: { id: 'vm-1' } });
      expect(res.status).toBe(413);
      const data = await res.json();
      expect(data.error).toContain('File terlalu besar');
    });

    it('should return file content, size, and filename when valid', async () => {
      mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });
      mockExecute
        .mockResolvedValueOnce('52') // stat size
        .mockResolvedValueOnce('PORT=8080\nDB_HOST=127.0.0.1\nNODE_ENV=production\n'); // read content

      const req = new Request('http://localhost/api/vms/vm-1/files/read?path=/var/www/.env');
      const res = await GET_FILE_READ(req, { params: { id: 'vm-1' } });
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.path).toBe('/var/www/.env');
      expect(data.filename).toBe('.env');
      expect(data.size).toBe(52);
      expect(data.content).toContain('PORT=8080');
    });
  });

  describe('POST /api/vms/:id/files/save', () => {
    it('should return 401 if unauthenticated', async () => {
      mockGetServerSession.mockResolvedValue(null);
      const req = new Request('http://localhost/api/vms/vm-1/files/save', {
        method: 'POST',
        body: JSON.stringify({ path: '/var/www/.env', content: 'FOO=bar' }),
      });
      const res = await POST_FILE_SAVE(req, { params: { id: 'vm-1' } });
      expect(res.status).toBe(401);
    });

    it('should return 400 for invalid body or missing path/content', async () => {
      mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });
      const req = new Request('http://localhost/api/vms/vm-1/files/save', {
        method: 'POST',
        body: JSON.stringify({ path: '/var/www/.env' }), // missing content
      });
      const res = await POST_FILE_SAVE(req, { params: { id: 'vm-1' } });
      expect(res.status).toBe(400);
    });

    it('should save file with base64 encoding and create backup by default', async () => {
      mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });
      mockExecute.mockResolvedValue('');

      const content = 'KEY=VALUE\nPORT=3000\n';
      const encoded = Buffer.from(content).toString('base64');

      const req = new Request('http://localhost/api/vms/vm-1/files/save', {
        method: 'POST',
        body: JSON.stringify({
          path: '/var/www/.env',
          content,
          createBackup: true,
        }),
      });
      const res = await POST_FILE_SAVE(req, { params: { id: 'vm-1' } });
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.path).toBe('/var/www/.env');
      expect(data.backupPath).toContain('/var/www/.env.bak-');
      expect(data.isSystemdUnit).toBe(false);

      // Verify execute calls
      const executedCommand = mockExecute.mock.calls[0][1];
      expect(executedCommand).toContain('cp -f -p "/var/www/.env"');
      expect(executedCommand).toContain(encoded);
      expect(executedCommand).toContain('sudo');
    });

    it('should run daemon-reload when editing a systemd unit file', async () => {
      mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });
      mockExecute.mockResolvedValue('');

      const req = new Request('http://localhost/api/vms/vm-1/files/save', {
        method: 'POST',
        body: JSON.stringify({
          path: '/etc/systemd/system/paradise.service',
          content: '[Unit]\nDescription=Test\n',
          createBackup: false,
        }),
      });
      const res = await POST_FILE_SAVE(req, { params: { id: 'vm-1' } });
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.isSystemdUnit).toBe(true);
      expect(data.backupPath).toBeUndefined();

      // Verify daemon-reload was included in the script
      const calls = mockExecute.mock.calls.map((c) => c[1]);
      expect(calls.some((c) => c.includes('systemctl daemon-reload'))).toBe(true);
    });

    it('should return clear permission error message when command fails with permission denied', async () => {
      mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });
      mockExecute.mockRejectedValue(new Error('Command failed (exit code 1): cp: cannot create regular file: Permission denied'));

      const req = new Request('http://localhost/api/vms/vm-1/files/save', {
        method: 'POST',
        body: JSON.stringify({
          path: '/etc/systemd/system/paradise.service',
          content: 'test',
        }),
      });
      const res = await POST_FILE_SAVE(req, { params: { id: 'vm-1' } });
      expect(res.status).toBe(500);

      const data = await res.json();
      expect(data.error).toContain('Akses ditolak (Permission Denied)');
      expect(data.error).toContain('sudo / root');
    });
  });
});
