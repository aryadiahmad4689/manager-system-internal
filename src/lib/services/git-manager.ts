import { getSSHManager } from '../ssh/ssh-manager';

export interface GitRepoInfo {
  isRepo: boolean;
  branch?: string;
  commitHash?: string;
  commitMessage?: string;
  author?: string;
  date?: string;
  modifiedFilesCount?: number;
}

export function parseGitOutput(raw: string): GitRepoInfo {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.includes('NOT_A_REPO')) {
    return { isRepo: false };
  }

  // Expect line: GIT_OK|branch|hash|msg|author|date|uncommitted
  const lines = trimmed.split('\n');
  for (const line of lines) {
    if (line.startsWith('GIT_OK|')) {
      const parts = line.split('|');
      return {
        isRepo: true,
        branch: parts[1] || undefined,
        commitHash: parts[2] || undefined,
        commitMessage: parts[3] || undefined,
        author: parts[4] || undefined,
        date: parts[5] || undefined,
        modifiedFilesCount: parseInt(parts[6], 10) || 0,
      };
    }
  }

  return { isRepo: false };
}

export class GitManager {
  private sshManager: { executeCommand(vmId: string, command: string): Promise<string> };

  constructor(sshManager?: { executeCommand(vmId: string, command: string): Promise<string> }) {
    this.sshManager = sshManager || getSSHManager();
  }

  async getRepoInfo(vmId: string, dirPath: string): Promise<GitRepoInfo> {
    const cmd = `cd "${dirPath}" 2>/dev/null && if [ -d ".git" ]; then
      b=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
      h=$(git log -1 --format="%h" 2>/dev/null || echo "")
      m=$(git log -1 --format="%s" 2>/dev/null || echo "")
      a=$(git log -1 --format="%an" 2>/dev/null || echo "")
      d=$(git log -1 --format="%cr" 2>/dev/null || echo "")
      c=$(git status --porcelain 2>/dev/null | wc -l)
      echo "GIT_OK|$b|$h|$m|$a|$d|$c"
    else
      echo "NOT_A_REPO"
    fi`;

    const output = await this.sshManager.executeCommand(vmId, cmd);
    return parseGitOutput(output);
  }

  async pull(vmId: string, dirPath: string): Promise<{ success: boolean; output: string }> {
    const cmd = `cd "${dirPath}" 2>/dev/null && git pull 2>&1`;
    const output = await this.sshManager.executeCommand(vmId, cmd);
    const success = !/fatal:|error:/i.test(output);
    return { success, output: output.trim() };
  }
}

let gitManagerInstance: GitManager | null = null;

export function getGitManager(): GitManager {
  if (!gitManagerInstance) {
    gitManagerInstance = new GitManager();
  }
  return gitManagerInstance;
}
