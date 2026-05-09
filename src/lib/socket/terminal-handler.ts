import { AuthenticatedSocket } from './socket-server';
import { getSSHManager, SSHShellStream } from '../ssh/ssh-manager';
import { handleSSHError } from '../ssh/ssh-error-handler';

/**
 * Tracks the active shell session for a socket connection.
 * Each socket can have at most one active terminal session.
 */
interface TerminalSession {
  shell: SSHShellStream;
  vmId: string;
}

/**
 * Map of socket IDs to their active terminal sessions.
 */
const activeSessions = new Map<string, TerminalSession>();

/**
 * Cleans up the terminal session for a given socket.
 * Closes the shell and removes the session from tracking.
 */
function cleanupSession(socketId: string): void {
  const session = activeSessions.get(socketId);
  if (session) {
    try {
      session.shell.close();
    } catch {
      // Shell may already be closed; ignore errors during cleanup
    }
    activeSessions.delete(socketId);
  }
}

/**
 * Registers terminal WebSocket event handlers on an authenticated socket.
 *
 * Handles:
 * - terminal:open — creates an SSH shell session for the given vmId
 * - terminal:input — writes data to the SSH stream
 * - terminal:resize — resizes the PTY dimensions
 * - terminal:close — closes the SSH shell and cleans up
 *
 * Emits:
 * - terminal:output — forwards SSH output to the client
 * - terminal:error — forwards connection errors as user-friendly messages
 * - terminal:close — notifies the client when the session ends
 */
export function registerTerminalHandlers(socket: AuthenticatedSocket): void {
  // Handle terminal:open — create SSH shell session
  socket.on('terminal:open', async (vmId: string, initialSize?: { cols: number; rows: number }) => {
    // Close any existing session for this socket
    cleanupSession(socket.id);

    try {
      const sshManager = getSSHManager();
      const cols = initialSize?.cols || 80;
      const rows = initialSize?.rows || 24;
      const shell = await sshManager.openShell(vmId, cols, rows);

      // Track the session
      activeSessions.set(socket.id, { shell, vmId });

      // Forward SSH output to client
      shell.onData((data: string) => {
        socket.emit('terminal:output', data);
      });

      // Handle shell close — notify client and clean up
      shell.onClose(() => {
        activeSessions.delete(socket.id);
        socket.emit('terminal:close');
      });
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      const errorInfo = handleSSHError(error);
      socket.emit('terminal:error', errorInfo.message);
    }
  });

  // Handle terminal:input — write data to SSH stream
  socket.on('terminal:input', (data: string) => {
    const session = activeSessions.get(socket.id);
    if (session) {
      try {
        session.shell.write(data);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        const errorInfo = handleSSHError(error);
        socket.emit('terminal:error', errorInfo.message);
      }
    }
  });

  // Handle terminal:resize — resize PTY dimensions
  socket.on('terminal:resize', (cols: number, rows: number) => {
    const session = activeSessions.get(socket.id);
    if (session) {
      try {
        session.shell.resize(cols, rows);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        const errorInfo = handleSSHError(error);
        socket.emit('terminal:error', errorInfo.message);
      }
    }
  });

  // Handle terminal:close — close SSH shell and clean up
  socket.on('terminal:close', () => {
    cleanupSession(socket.id);
    socket.emit('terminal:close');
  });

  // Handle terminal:list-logs — list files via a separate exec channel
  // Uses the directory provided, or defaults to the SSH user's home directory
  socket.on('terminal:list-logs', async (vmId: string, directory?: string) => {
    try {
      const sshManager = getSSHManager();

      // Use unique markers to isolate command output from SSH banner/MOTD
      const marker = `__LS_START_${Date.now()}__`;
      const endMarker = `__LS_END_${Date.now()}__`;

      // If no directory, default to home dir
      let dir = directory;
      if (!dir) {
        const homeOutput = await sshManager.executeCommand(vmId, `echo ${marker} && echo $HOME && echo ${endMarker}`);
        const homeMatch = homeOutput.match(new RegExp(`${marker}\\n(.+?)\\n${endMarker}`));
        dir = homeMatch ? homeMatch[1].trim() : '/root';
      }

      // Fast ls with markers to filter out banner
      const output = await sshManager.executeCommand(
        vmId,
        `echo ${marker} && cd "${dir}" 2>/dev/null && pwd && echo "---" && ls -1tp 2>/dev/null && echo ${endMarker}`
      );

      // Extract content between markers
      const startIdx = output.indexOf(marker);
      const endIdx = output.indexOf(endMarker);
      const cleanOutput = startIdx >= 0 && endIdx >= 0
        ? output.substring(startIdx + marker.length, endIdx).trim()
        : output.trim();

      const lines = cleanOutput.split('\n');
      // First line is the resolved absolute path (from pwd)
      const resolvedDir = lines[0] || dir;
      // Find separator
      const sepIdx = lines.indexOf('---');
      const fileLines = sepIdx >= 0 ? lines.slice(sepIdx + 1) : lines.slice(1);

      const entries = fileLines
        .filter((f) => f.trim().length > 0)
        .map((entry) => ({
          name: entry.replace(/\/$/, ''),
          isDir: entry.endsWith('/'),
          path: `${resolvedDir}/${entry.replace(/\/$/, '')}`,
        }));

      socket.emit('terminal:log-files', { directory: resolvedDir, entries });
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      socket.emit('terminal:log-files', { directory: directory || '/', entries: [] });
      socket.emit('terminal:error', `Failed to list files: ${error.message}`);
    }
  });

  // Handle socket disconnect — clean up any active session
  socket.on('disconnect', () => {
    cleanupSession(socket.id);
  });
}

/**
 * Returns the active sessions map (for testing/monitoring).
 */
export function getActiveSessions(): Map<string, TerminalSession> {
  return activeSessions;
}

/**
 * Clears all active sessions (useful for testing).
 */
export function clearActiveSessions(): void {
  for (const [socketId] of activeSessions) {
    cleanupSession(socketId);
  }
  activeSessions.clear();
}
