import { AuthenticatedSocket } from './socket-server';
import { getSSHManager, SSHShellStream } from '../ssh/ssh-manager';
import { parseLogLine } from '../logs/log-reader';
import { handleSSHError } from '../ssh/ssh-error-handler';

/**
 * Tracks the active log subscription for a socket connection.
 * Each socket can have at most one active log subscription.
 */
interface LogSubscription {
  shell: SSHShellStream;
  vmId: string;
  project: string;
  filename: string;
}

/**
 * Map of socket IDs to their active log subscriptions.
 */
const activeSubscriptions = new Map<string, LogSubscription>();

/**
 * Cleans up the log subscription for a given socket.
 * Closes the shell and removes the subscription from tracking.
 */
function cleanupSubscription(socketId: string): void {
  const subscription = activeSubscriptions.get(socketId);
  if (subscription) {
    try {
      subscription.shell.close();
    } catch {
      // Shell may already be closed; ignore errors during cleanup
    }
    activeSubscriptions.delete(socketId);
  }
}

/**
 * Registers log streaming WebSocket event handlers on an authenticated socket.
 *
 * Handles:
 * - log:subscribe — starts a `tail -f` on the specified log file via SSH shell
 * - log:unsubscribe — stops the tail process and cleans up
 *
 * Emits:
 * - log:newEntry — forwards parsed log entries to the client in real-time
 */
export function registerLogHandlers(socket: AuthenticatedSocket): void {
  // Handle log:subscribe — start tail -f on log file via SSH shell
  socket.on('log:subscribe', async (vmId: string, project: string, filename: string) => {
    // Close any existing subscription for this socket
    cleanupSubscription(socket.id);

    try {
      const sshManager = getSSHManager();
      const shell = await sshManager.openShell(vmId);

      // Track the subscription
      activeSubscriptions.set(socket.id, { shell, vmId, project, filename });

      // Buffer for incomplete lines
      let lineBuffer = '';

      // Forward parsed log entries to client
      shell.onData((data: string) => {
        lineBuffer += data;

        // Process complete lines
        const lines = lineBuffer.split('\n');
        // Keep the last element as it may be an incomplete line
        lineBuffer = lines.pop() || '';

        for (const line of lines) {
          const entry = parseLogLine(line);
          if (entry) {
            socket.emit('log:newEntry', entry);
          }
        }
      });

      // Handle shell close — clean up subscription
      shell.onClose(() => {
        activeSubscriptions.delete(socket.id);
      });

      // Write the tail -f command to the shell
      const logPath = `/var/www/html/${project}/application/logs/${filename}`;
      shell.write(`tail -f ${logPath}\n`);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      const errorInfo = handleSSHError(error);
      socket.emit('terminal:error', errorInfo.message);
    }
  });

  // Handle log:unsubscribe — stop tail process and clean up
  socket.on('log:unsubscribe', () => {
    cleanupSubscription(socket.id);
  });

  // Handle socket disconnect — clean up any active subscription
  socket.on('disconnect', () => {
    cleanupSubscription(socket.id);
  });
}

/**
 * Returns the active subscriptions map (for testing/monitoring).
 */
export function getActiveSubscriptions(): Map<string, LogSubscription> {
  return activeSubscriptions;
}

/**
 * Clears all active subscriptions (useful for testing).
 */
export function clearActiveSubscriptions(): void {
  for (const [socketId] of activeSubscriptions) {
    cleanupSubscription(socketId);
  }
  activeSubscriptions.clear();
}
