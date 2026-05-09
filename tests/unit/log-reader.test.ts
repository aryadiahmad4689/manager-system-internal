import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  LogReaderImpl,
  createLogReader,
  parseLogLine,
  parseLogContent,
  LogEntry,
} from '@/lib/logs/log-reader';

describe('LogReader', () => {
  let mockSSHManager: { executeCommand: ReturnType<typeof vi.fn> };
  let logReader: LogReaderImpl;

  beforeEach(() => {
    mockSSHManager = {
      executeCommand: vi.fn(),
    };
    logReader = createLogReader(mockSSHManager);
  });

  describe('parseLogLine', () => {
    it('should parse a valid ERROR log line', () => {
      const line = 'ERROR - 2024-01-15 10:23:45 --> Error message here';
      const entry = parseLogLine(line);

      expect(entry).toEqual({
        level: 'ERROR',
        timestamp: '2024-01-15 10:23:45',
        message: 'Error message here',
        raw: line,
      });
    });

    it('should parse a valid DEBUG log line', () => {
      const line = 'DEBUG - 2024-01-15 10:23:46 --> Debug message here';
      const entry = parseLogLine(line);

      expect(entry).toEqual({
        level: 'DEBUG',
        timestamp: '2024-01-15 10:23:46',
        message: 'Debug message here',
        raw: line,
      });
    });

    it('should parse a valid INFO log line', () => {
      const line = 'INFO  - 2024-01-15 10:23:47 --> Info message here';
      const entry = parseLogLine(line);

      expect(entry).toEqual({
        level: 'INFO',
        timestamp: '2024-01-15 10:23:47',
        message: 'Info message here',
        raw: line,
      });
    });

    it('should parse an ALL level log line', () => {
      const line = 'ALL   - 2024-01-15 10:23:48 --> All level message';
      const entry = parseLogLine(line);

      expect(entry).toEqual({
        level: 'ALL',
        timestamp: '2024-01-15 10:23:48',
        message: 'All level message',
        raw: line,
      });
    });

    it('should skip empty lines', () => {
      expect(parseLogLine('')).toBeNull();
      expect(parseLogLine('   ')).toBeNull();
    });

    it('should skip PHP guard line', () => {
      const line = "<?php defined('BASEPATH') OR exit('No direct script access allowed'); ?>";
      expect(parseLogLine(line)).toBeNull();
    });

    it('should return raw entry for unparseable lines', () => {
      const line = 'Some random text that is not a log entry';
      const entry = parseLogLine(line);

      expect(entry).toEqual({
        level: 'ALL',
        timestamp: '',
        message: line,
        raw: line,
      });
    });

    it('should handle lines with extra whitespace', () => {
      const line = '  ERROR - 2024-01-15 10:23:45 --> Trimmed message  ';
      const entry = parseLogLine(line);

      expect(entry).toEqual({
        level: 'ERROR',
        timestamp: '2024-01-15 10:23:45',
        message: 'Trimmed message',
        raw: 'ERROR - 2024-01-15 10:23:45 --> Trimmed message',
      });
    });
  });

  describe('parseLogContent', () => {
    it('should parse a full log file content', () => {
      const content = `<?php defined('BASEPATH') OR exit('No direct script access allowed'); ?>

ERROR - 2024-01-15 10:23:45 --> Error message here
DEBUG - 2024-01-15 10:23:46 --> Debug message here
INFO  - 2024-01-15 10:23:47 --> Info message here`;

      const entries = parseLogContent(content);

      expect(entries).toHaveLength(3);
      expect(entries[0].level).toBe('ERROR');
      expect(entries[1].level).toBe('DEBUG');
      expect(entries[2].level).toBe('INFO');
    });

    it('should handle empty content', () => {
      expect(parseLogContent('')).toEqual([]);
    });

    it('should include unparseable lines as raw entries', () => {
      const content = `<?php defined('BASEPATH') OR exit('No direct script access allowed'); ?>

ERROR - 2024-01-15 10:23:45 --> Error message
some random text
DEBUG - 2024-01-15 10:23:46 --> Debug message`;

      const entries = parseLogContent(content);

      expect(entries).toHaveLength(3);
      expect(entries[0].level).toBe('ERROR');
      expect(entries[1]).toEqual({
        level: 'ALL',
        timestamp: '',
        message: 'some random text',
        raw: 'some random text',
      });
      expect(entries[2].level).toBe('DEBUG');
    });
  });

  describe('listProjects', () => {
    it('should list projects from /var/www/html/', async () => {
      mockSSHManager.executeCommand
        .mockResolvedValueOnce('/var/www/html/project-a/\n/var/www/html/project-b/\n')
        .mockResolvedValueOnce('3\n') // log count for project-a
        .mockResolvedValueOnce('5\n'); // log count for project-b

      const projects = await logReader.listProjects('vm-1');

      expect(projects).toHaveLength(2);
      expect(projects[0]).toEqual({
        name: 'project-a',
        path: '/var/www/html/project-a',
        logCount: 3,
      });
      expect(projects[1]).toEqual({
        name: 'project-b',
        path: '/var/www/html/project-b',
        logCount: 5,
      });

      expect(mockSSHManager.executeCommand).toHaveBeenCalledWith(
        'vm-1',
        'ls -d /var/www/html/*/'
      );
    });

    it('should handle projects with no log directory', async () => {
      mockSSHManager.executeCommand
        .mockResolvedValueOnce('/var/www/html/project-a/\n')
        .mockRejectedValueOnce(new Error('No such file or directory'));

      const projects = await logReader.listProjects('vm-1');

      expect(projects).toHaveLength(1);
      expect(projects[0].logCount).toBe(0);
    });

    it('should handle empty directory listing', async () => {
      mockSSHManager.executeCommand.mockResolvedValueOnce('');

      const projects = await logReader.listProjects('vm-1');

      expect(projects).toHaveLength(0);
    });
  });

  describe('listLogFiles', () => {
    it('should list log files with dates and sizes', async () => {
      const lsOutput = `-rw-r--r-- 1 www-data www-data 1234 Jan 15 10:00 /var/www/html/myapp/application/logs/log-2024-01-15.php
-rw-r--r-- 1 www-data www-data 5678 Jan 14 10:00 /var/www/html/myapp/application/logs/log-2024-01-14.php`;

      mockSSHManager.executeCommand.mockResolvedValueOnce(lsOutput);

      const files = await logReader.listLogFiles('vm-1', 'myapp');

      expect(files).toHaveLength(2);
      expect(files[0]).toEqual({
        filename: 'log-2024-01-15.php',
        date: '2024-01-15',
        size: 1234,
      });
      expect(files[1]).toEqual({
        filename: 'log-2024-01-14.php',
        date: '2024-01-14',
        size: 5678,
      });

      expect(mockSSHManager.executeCommand).toHaveBeenCalledWith(
        'vm-1',
        'ls -l /var/www/html/myapp/application/logs/log-*.php 2>/dev/null'
      );
    });

    it('should handle empty log directory', async () => {
      mockSSHManager.executeCommand.mockResolvedValueOnce('');

      const files = await logReader.listLogFiles('vm-1', 'myapp');

      expect(files).toHaveLength(0);
    });

    it('should skip non-matching filenames', async () => {
      const lsOutput = `-rw-r--r-- 1 www-data www-data 1234 Jan 15 10:00 /var/www/html/myapp/application/logs/log-2024-01-15.php
-rw-r--r-- 1 www-data www-data 5678 Jan 14 10:00 /var/www/html/myapp/application/logs/index.html`;

      mockSSHManager.executeCommand.mockResolvedValueOnce(lsOutput);

      const files = await logReader.listLogFiles('vm-1', 'myapp');

      expect(files).toHaveLength(1);
      expect(files[0].filename).toBe('log-2024-01-15.php');
    });
  });

  describe('readLogFile', () => {
    it('should read and parse a log file', async () => {
      const fileContent = `<?php defined('BASEPATH') OR exit('No direct script access allowed'); ?>

ERROR - 2024-01-15 10:23:45 --> Database connection failed
DEBUG - 2024-01-15 10:23:46 --> Retrying connection`;

      mockSSHManager.executeCommand.mockResolvedValueOnce(fileContent);

      const entries = await logReader.readLogFile('vm-1', 'myapp', 'log-2024-01-15.php');

      expect(entries).toHaveLength(2);
      expect(entries[0]).toEqual({
        level: 'ERROR',
        timestamp: '2024-01-15 10:23:45',
        message: 'Database connection failed',
        raw: 'ERROR - 2024-01-15 10:23:45 --> Database connection failed',
      });
      expect(entries[1]).toEqual({
        level: 'DEBUG',
        timestamp: '2024-01-15 10:23:46',
        message: 'Retrying connection',
        raw: 'DEBUG - 2024-01-15 10:23:46 --> Retrying connection',
      });

      expect(mockSSHManager.executeCommand).toHaveBeenCalledWith(
        'vm-1',
        'cat /var/www/html/myapp/application/logs/log-2024-01-15.php'
      );
    });

    it('should handle unparseable lines as raw entries', async () => {
      const fileContent = `<?php defined('BASEPATH') OR exit('No direct script access allowed'); ?>

ERROR - 2024-01-15 10:23:45 --> Error message
Stack trace: line 42 in file.php
DEBUG - 2024-01-15 10:23:46 --> Debug message`;

      mockSSHManager.executeCommand.mockResolvedValueOnce(fileContent);

      const entries = await logReader.readLogFile('vm-1', 'myapp', 'log-2024-01-15.php');

      expect(entries).toHaveLength(3);
      expect(entries[1]).toEqual({
        level: 'ALL',
        timestamp: '',
        message: 'Stack trace: line 42 in file.php',
        raw: 'Stack trace: line 42 in file.php',
      });
    });
  });

  describe('searchLogs', () => {
    it('should filter entries by query string (case-insensitive)', async () => {
      const fileContent = `<?php defined('BASEPATH') OR exit('No direct script access allowed'); ?>

ERROR - 2024-01-15 10:23:45 --> Database connection failed
DEBUG - 2024-01-15 10:23:46 --> Cache cleared
ERROR - 2024-01-15 10:23:47 --> Database timeout`;

      mockSSHManager.executeCommand.mockResolvedValueOnce(fileContent);

      const results = await logReader.searchLogs('vm-1', 'myapp', 'database', 'log-2024-01-15.php');

      expect(results).toHaveLength(2);
      expect(results[0].message).toBe('Database connection failed');
      expect(results[1].message).toBe('Database timeout');
    });

    it('should search case-insensitively', async () => {
      const fileContent = `<?php defined('BASEPATH') OR exit('No direct script access allowed'); ?>

ERROR - 2024-01-15 10:23:45 --> DATABASE error occurred
DEBUG - 2024-01-15 10:23:46 --> database reconnected`;

      mockSSHManager.executeCommand.mockResolvedValueOnce(fileContent);

      const results = await logReader.searchLogs('vm-1', 'myapp', 'Database', 'log-2024-01-15.php');

      expect(results).toHaveLength(2);
    });

    it('should search across all files when no filename provided', async () => {
      // First call: listLogFiles
      const lsOutput = `-rw-r--r-- 1 www-data www-data 100 Jan 15 10:00 /var/www/html/myapp/application/logs/log-2024-01-15.php
-rw-r--r-- 1 www-data www-data 200 Jan 14 10:00 /var/www/html/myapp/application/logs/log-2024-01-14.php`;

      const file1Content = `<?php defined('BASEPATH') OR exit('No direct script access allowed'); ?>

ERROR - 2024-01-15 10:23:45 --> Error in file 1`;

      const file2Content = `<?php defined('BASEPATH') OR exit('No direct script access allowed'); ?>

ERROR - 2024-01-14 10:23:45 --> Error in file 2`;

      mockSSHManager.executeCommand
        .mockResolvedValueOnce(lsOutput) // listLogFiles
        .mockResolvedValueOnce(file1Content) // readLogFile for file 1
        .mockResolvedValueOnce(file2Content); // readLogFile for file 2

      const results = await logReader.searchLogs('vm-1', 'myapp', 'Error');

      expect(results).toHaveLength(2);
      expect(results[0].message).toBe('Error in file 1');
      expect(results[1].message).toBe('Error in file 2');
    });

    it('should return empty array when no matches found', async () => {
      const fileContent = `<?php defined('BASEPATH') OR exit('No direct script access allowed'); ?>

ERROR - 2024-01-15 10:23:45 --> Database error
DEBUG - 2024-01-15 10:23:46 --> Cache cleared`;

      mockSSHManager.executeCommand.mockResolvedValueOnce(fileContent);

      const results = await logReader.searchLogs('vm-1', 'myapp', 'nonexistent', 'log-2024-01-15.php');

      expect(results).toHaveLength(0);
    });

    it('should match against raw content of unparseable lines', async () => {
      const fileContent = `<?php defined('BASEPATH') OR exit('No direct script access allowed'); ?>

ERROR - 2024-01-15 10:23:45 --> Normal error
Stack trace: NullPointerException at line 42`;

      mockSSHManager.executeCommand.mockResolvedValueOnce(fileContent);

      const results = await logReader.searchLogs('vm-1', 'myapp', 'NullPointer', 'log-2024-01-15.php');

      expect(results).toHaveLength(1);
      expect(results[0].message).toBe('Stack trace: NullPointerException at line 42');
    });
  });

  describe('streamLogFile', () => {
    it('should yield all entries from the file (stub implementation)', async () => {
      const fileContent = `<?php defined('BASEPATH') OR exit('No direct script access allowed'); ?>

ERROR - 2024-01-15 10:23:45 --> Error message
DEBUG - 2024-01-15 10:23:46 --> Debug message`;

      mockSSHManager.executeCommand.mockResolvedValueOnce(fileContent);

      const entries: LogEntry[] = [];
      for await (const entry of logReader.streamLogFile('vm-1', 'myapp', 'log-2024-01-15.php')) {
        entries.push(entry);
      }

      expect(entries).toHaveLength(2);
      expect(entries[0].level).toBe('ERROR');
      expect(entries[1].level).toBe('DEBUG');
    });
  });
});
