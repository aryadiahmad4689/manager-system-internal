import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseGitOutput, GitManager } from '@/lib/services/git-manager';

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
import { GET as GET_GIT } from '@/app/api/vms/[id]/services/git/route';
import { POST as POST_GIT_PULL } from '@/app/api/vms/[id]/services/git-pull/route';

const mockGetServerSession = vi.mocked(getServerSession);
const mockGetSSHManager = vi.mocked(getSSHManager);

describe('Git Manager & APIs', () => {
  const mockExecute = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSSHManager.mockReturnValue({
      executeCommand: mockExecute,
    } as any);
  });

  describe('parseGitOutput', () => {
    it('should parse valid git output', () => {
      const raw = 'GIT_OK|main|7a3b4c1|feat: add payment gateway|Alice|2 hours ago|0';
      const info = parseGitOutput(raw);

      expect(info.isRepo).toBe(true);
      expect(info.branch).toBe('main');
      expect(info.commitHash).toBe('7a3b4c1');
      expect(info.commitMessage).toBe('feat: add payment gateway');
      expect(info.author).toBe('Alice');
      expect(info.date).toBe('2 hours ago');
      expect(info.modifiedFilesCount).toBe(0);
    });

    it('should return isRepo: false for NOT_A_REPO', () => {
      expect(parseGitOutput('NOT_A_REPO').isRepo).toBe(false);
      expect(parseGitOutput('').isRepo).toBe(false);
    });
  });

  describe('GitManager class', () => {
    it('should query repo info via ssh', async () => {
      mockExecute.mockResolvedValue('GIT_OK|develop|abc1234|fix: bug|Bob|1 day ago|2');
      const gm = new GitManager({ executeCommand: mockExecute });
      const info = await gm.getRepoInfo('vm-1', '/home/app');

      expect(info.isRepo).toBe(true);
      expect(info.branch).toBe('develop');
      expect(info.modifiedFilesCount).toBe(2);
    });

    it('should run git pull and detect success', async () => {
      mockExecute.mockResolvedValue('Already up to date.');
      const gm = new GitManager({ executeCommand: mockExecute });
      const result = await gm.pull('vm-1', '/home/app');

      expect(result.success).toBe(true);
      expect(result.output).toBe('Already up to date.');
    });

    it('should detect git pull failure', async () => {
      mockExecute.mockResolvedValue('fatal: not a git repository');
      const gm = new GitManager({ executeCommand: mockExecute });
      const result = await gm.pull('vm-1', '/home/app');

      expect(result.success).toBe(false);
    });
  });

  describe('Git API Routes', () => {
    it('GET /api/vms/:id/services/git returns repo info', async () => {
      mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });
      mockExecute.mockResolvedValue('GIT_OK|main|1234567|init|Charlie|now|0');

      const req = new Request('http://localhost/api/vms/vm-1/services/git?path=/var/www');
      const res = await GET_GIT(req, { params: { id: 'vm-1' } });
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.isRepo).toBe(true);
      expect(data.branch).toBe('main');
    });

    it('POST /api/vms/:id/services/git-pull runs git pull', async () => {
      mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });
      mockExecute.mockResolvedValue('Updating 7a3b4c1..abc1234\nFast-forward');

      const req = new Request('http://localhost/api/vms/vm-1/services/git-pull', {
        method: 'POST',
        body: JSON.stringify({ path: '/var/www' }),
      });
      const res = await POST_GIT_PULL(req, { params: { id: 'vm-1' } });
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.output).toContain('Fast-forward');
    });
  });
});
