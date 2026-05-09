import { getSSHManager } from '../ssh/ssh-manager';

/**
 * Represents a project directory on a VM that may contain CodeIgniter logs.
 */
export interface LogProject {
  name: string;
  path: string;
  logCount: number;
}

/**
 * Represents a single CodeIgniter log file.
 */
export interface LogFile {
  filename: string; // e.g., "log-2024-01-15.php"
  date: string; // e.g., "2024-01-15"
  size: number; // bytes
}

/**
 * Represents a parsed log entry from a CodeIgniter log file.
 */
export interface LogEntry {
  level: 'ERROR' | 'DEBUG' | 'INFO' | 'ALL';
  timestamp: string;
  message: string;
  raw: string;
}

/**
 * Interface for reading and parsing CodeIgniter logs from VMs via SSH.
 */
export interface LogReader {
  listProjects(vmId: string): Promise<LogProject[]>;
  listLogFiles(vmId: string, project: string): Promise<LogFile[]>;
  readLogFile(vmId: string, project: string, filename: string): Promise<LogEntry[]>;
  streamLogFile(vmId: string, project: string, filename: string): AsyncGenerator<LogEntry>;
  searchLogs(vmId: string, project: string, query: string, filename?: string): Promise<LogEntry[]>;
}

/**
 * Regex for parsing CodeIgniter log entries.
 * Matches: LEVEL - YYYY-MM-DD HH:MM:SS --> message
 */
const LOG_ENTRY_REGEX = /^(ERROR|DEBUG|INFO|ALL)\s+-\s+(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})\s+-->\s+(.+)$/;

/**
 * Regex for matching CodeIgniter log filenames.
 */
const LOG_FILENAME_REGEX = /^log-(\d{4}-\d{2}-\d{2})\.php$/;

/**
 * Base path for web projects on the VM.
 */
const BASE_PATH = '/var/www/html';

/**
 * Parses a single line from a CodeIgniter log file into a LogEntry.
 * Returns a raw entry if the line cannot be parsed.
 */
export function parseLogLine(line: string): LogEntry | null {
  const trimmed = line.trim();

  // Skip empty lines
  if (!trimmed) {
    return null;
  }

  // Skip PHP guard line
  if (trimmed.startsWith('<?php')) {
    return null;
  }

  const match = trimmed.match(LOG_ENTRY_REGEX);
  if (match) {
    return {
      level: match[1] as LogEntry['level'],
      timestamp: match[2],
      message: match[3],
      raw: trimmed,
    };
  }

  // Unparseable line — return as raw entry
  return {
    level: 'ALL',
    timestamp: '',
    message: trimmed,
    raw: trimmed,
  };
}

/**
 * Parses the full content of a CodeIgniter log file into LogEntry array.
 */
export function parseLogContent(content: string): LogEntry[] {
  const lines = content.split('\n');
  const entries: LogEntry[] = [];

  for (const line of lines) {
    const entry = parseLogLine(line);
    if (entry) {
      entries.push(entry);
    }
  }

  return entries;
}

/**
 * LogReader implementation that reads CodeIgniter logs from VMs via SSH.
 */
export class LogReaderImpl implements LogReader {
  private sshManager: { executeCommand(vmId: string, command: string): Promise<string> };

  constructor(sshManager?: { executeCommand(vmId: string, command: string): Promise<string> }) {
    this.sshManager = sshManager || getSSHManager();
  }

  /**
   * Lists all project directories in /var/www/html/ on the VM.
   * For each project, counts the number of log files in its application/logs/ directory.
   */
  async listProjects(vmId: string): Promise<LogProject[]> {
    const output = await this.sshManager.executeCommand(
      vmId,
      `ls -d ${BASE_PATH}/*/`
    );

    const dirs = output.trim().split('\n').filter(Boolean);
    const projects: LogProject[] = [];

    for (const dir of dirs) {
      const name = dir.replace(/\/$/, '').split('/').pop();
      if (!name) continue;

      const logDir = `${BASE_PATH}/${name}/application/logs`;
      let logCount = 0;

      try {
        const countOutput = await this.sshManager.executeCommand(
          vmId,
          `ls ${logDir}/log-*.php 2>/dev/null | wc -l`
        );
        logCount = parseInt(countOutput.trim(), 10) || 0;
      } catch {
        // Log directory may not exist — that's fine, count stays 0
      }

      projects.push({
        name,
        path: `${BASE_PATH}/${name}`,
        logCount,
      });
    }

    return projects;
  }

  /**
   * Lists all CodeIgniter log files for a given project on the VM.
   * Returns files matching the pattern log-YYYY-MM-DD.php with their sizes.
   */
  async listLogFiles(vmId: string, project: string): Promise<LogFile[]> {
    const logDir = `${BASE_PATH}/${project}/application/logs`;

    const output = await this.sshManager.executeCommand(
      vmId,
      `ls -l ${logDir}/log-*.php 2>/dev/null`
    );

    const lines = output.trim().split('\n').filter(Boolean);
    const files: LogFile[] = [];

    for (const line of lines) {
      // ls -l output format: -rw-r--r-- 1 user group SIZE DATE TIME FILENAME
      const parts = line.trim().split(/\s+/);
      if (parts.length < 9) continue;

      const size = parseInt(parts[4], 10) || 0;
      const filename = parts[parts.length - 1].split('/').pop() || '';

      const filenameMatch = filename.match(LOG_FILENAME_REGEX);
      if (filenameMatch) {
        files.push({
          filename,
          date: filenameMatch[1],
          size,
        });
      }
    }

    return files;
  }

  /**
   * Reads and parses a CodeIgniter log file from the VM.
   * Skips the PHP guard line and parses each log entry.
   * Unparseable lines are returned as raw entries with level 'ALL'.
   */
  async readLogFile(vmId: string, project: string, filename: string): Promise<LogEntry[]> {
    const filePath = `${BASE_PATH}/${project}/application/logs/${filename}`;

    const content = await this.sshManager.executeCommand(
      vmId,
      `cat ${filePath}`
    );

    return parseLogContent(content);
  }

  /**
   * Searches log entries by query string (case-insensitive).
   * If filename is provided, searches only that file; otherwise searches all log files.
   */
  async searchLogs(vmId: string, project: string, query: string, filename?: string): Promise<LogEntry[]> {
    let entries: LogEntry[];

    if (filename) {
      entries = await this.readLogFile(vmId, project, filename);
    } else {
      // Search across all log files
      const files = await this.listLogFiles(vmId, project);
      entries = [];
      for (const file of files) {
        const fileEntries = await this.readLogFile(vmId, project, file.filename);
        entries.push(...fileEntries);
      }
    }

    const lowerQuery = query.toLowerCase();
    return entries.filter(
      (entry) =>
        entry.message.toLowerCase().includes(lowerQuery) ||
        entry.raw.toLowerCase().includes(lowerQuery)
    );
  }

  /**
   * Streams log entries from a file in real-time.
   * Stub implementation — will be fully implemented with Socket.IO in Task 11.3.
   */
  async *streamLogFile(vmId: string, project: string, filename: string): AsyncGenerator<LogEntry> {
    // Stub: read the file once and yield all entries
    const entries = await this.readLogFile(vmId, project, filename);
    for (const entry of entries) {
      yield entry;
    }
  }
}

/**
 * Singleton LogReader instance.
 */
let logReaderInstance: LogReaderImpl | null = null;

/**
 * Returns the singleton LogReader instance.
 */
export function getLogReader(): LogReaderImpl {
  if (!logReaderInstance) {
    logReaderInstance = new LogReaderImpl();
  }
  return logReaderInstance;
}

/**
 * Creates a new LogReader instance (useful for testing with custom SSH manager).
 */
export function createLogReader(sshManager?: { executeCommand(vmId: string, command: string): Promise<string> }): LogReaderImpl {
  return new LogReaderImpl(sshManager);
}

/**
 * Resets the singleton LogReader (useful for testing).
 */
export function resetLogReader(): void {
  logReaderInstance = null;
}
