'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';

/**
 * Represents a parsed log entry from a CodeIgniter log file.
 */
interface LogEntry {
  level: 'ERROR' | 'DEBUG' | 'INFO' | 'ALL';
  timestamp: string;
  message: string;
  raw: string;
}

/**
 * Represents a project directory on a VM.
 */
interface LogProject {
  name: string;
  path: string;
  logCount: number;
}

/**
 * Represents a log file in a project.
 */
interface LogFile {
  filename: string;
  date: string;
  size: number;
}

interface LogViewerProps {
  vmId: string;
  vmLabel: string;
  onClose: () => void;
}

/**
 * Returns the Tailwind text color class for a given log level.
 */
function getLevelColor(level: LogEntry['level']): string {
  switch (level) {
    case 'ERROR':
      return 'text-red-400';
    case 'DEBUG':
      return 'text-gray-400';
    case 'INFO':
      return 'text-blue-400';
    case 'ALL':
    default:
      return 'text-gray-500';
  }
}

/**
 * Returns a badge style for a given log level.
 */
function getLevelBadgeClass(level: LogEntry['level']): string {
  switch (level) {
    case 'ERROR':
      return 'bg-red-900/40 text-red-400 border-red-800';
    case 'DEBUG':
      return 'bg-gray-800/40 text-gray-400 border-gray-700';
    case 'INFO':
      return 'bg-blue-900/40 text-blue-400 border-blue-800';
    case 'ALL':
    default:
      return 'bg-gray-800/40 text-gray-500 border-gray-700';
  }
}

export default function LogViewer({ vmId, vmLabel, onClose }: LogViewerProps) {
  const [projects, setProjects] = useState<LogProject[]>([]);
  const [selectedProject, setSelectedProject] = useState<string>('');
  const [logFiles, setLogFiles] = useState<LogFile[]>([]);
  const [selectedFile, setSelectedFile] = useState<string>('');
  const [logEntries, setLogEntries] = useState<LogEntry[]>([]);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isLoadingProjects, setIsLoadingProjects] = useState(true);
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);
  const [isLoadingLogs, setIsLoadingLogs] = useState(false);
  const [error, setError] = useState<string>('');

  const logContainerRef = useRef<HTMLDivElement>(null);
  const socketRef = useRef<Socket | null>(null);
  const autoScrollRef = useRef(true);

  // Fetch projects on mount
  useEffect(() => {
    async function fetchProjects() {
      setIsLoadingProjects(true);
      setError('');
      try {
        const res = await fetch(`/api/vms/${vmId}/projects`);
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || 'Failed to fetch projects');
        }
        const data: LogProject[] = await res.json();
        setProjects(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch projects');
      } finally {
        setIsLoadingProjects(false);
      }
    }
    fetchProjects();
  }, [vmId]);

  // Fetch log files when project is selected
  useEffect(() => {
    if (!selectedProject) {
      setLogFiles([]);
      setSelectedFile('');
      setLogEntries([]);
      return;
    }

    async function fetchLogFiles() {
      setIsLoadingFiles(true);
      setError('');
      try {
        const res = await fetch(`/api/vms/${vmId}/logs/${selectedProject}`);
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || 'Failed to fetch log files');
        }
        const data: LogFile[] = await res.json();
        setLogFiles(data);
        setSelectedFile('');
        setLogEntries([]);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch log files');
      } finally {
        setIsLoadingFiles(false);
      }
    }
    fetchLogFiles();
  }, [vmId, selectedProject]);

  // Fetch log content when file is selected
  useEffect(() => {
    if (!selectedProject || !selectedFile) {
      setLogEntries([]);
      return;
    }

    async function fetchLogContent() {
      setIsLoadingLogs(true);
      setError('');
      try {
        const res = await fetch(`/api/vms/${vmId}/logs/${selectedProject}/${selectedFile}`);
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || 'Failed to read log file');
        }
        const data: LogEntry[] = await res.json();
        setLogEntries(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to read log file');
      } finally {
        setIsLoadingLogs(false);
      }
    }
    fetchLogContent();
  }, [vmId, selectedProject, selectedFile]);

  // Subscribe to real-time log streaming via Socket.IO
  useEffect(() => {
    if (!selectedProject || !selectedFile) {
      // Unsubscribe if no file selected
      if (socketRef.current) {
        socketRef.current.emit('log:unsubscribe');
        socketRef.current.disconnect();
        socketRef.current = null;
      }
      return;
    }

    const socket = io({
      path: '/api/socketio',
      transports: ['websocket', 'polling'],
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('log:subscribe', vmId, selectedProject, selectedFile);
    });

    socket.on('log:newEntry', (entry: LogEntry) => {
      setLogEntries((prev) => [...prev, entry]);
    });

    socket.on('connect_error', () => {
      // Silently handle connection errors for streaming
      // The log content is already loaded via API
    });

    return () => {
      socket.emit('log:unsubscribe');
      socket.disconnect();
      socketRef.current = null;
    };
  }, [vmId, selectedProject, selectedFile]);

  // Auto-scroll to bottom when new entries arrive
  useEffect(() => {
    if (autoScrollRef.current && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logEntries]);

  // Handle scroll to detect if user scrolled up (disable auto-scroll)
  const handleScroll = useCallback(() => {
    if (!logContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = logContainerRef.current;
    // If user is within 50px of bottom, enable auto-scroll
    autoScrollRef.current = scrollHeight - scrollTop - clientHeight < 50;
  }, []);

  // Handle search
  const handleSearch = useCallback(async () => {
    if (!selectedProject || !searchQuery.trim()) {
      // If search is cleared, reload the file content
      if (!searchQuery.trim() && selectedFile) {
        try {
          const res = await fetch(`/api/vms/${vmId}/logs/${selectedProject}/${selectedFile}`);
          if (res.ok) {
            const data: LogEntry[] = await res.json();
            setLogEntries(data);
          }
        } catch {
          // Ignore
        }
      }
      return;
    }

    setIsLoadingLogs(true);
    setError('');
    try {
      const params = new URLSearchParams({ q: searchQuery.trim() });
      const res = await fetch(`/api/vms/${vmId}/logs/${selectedProject}/search?${params}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Search failed');
      }
      const data: LogEntry[] = await res.json();
      setLogEntries(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
    } finally {
      setIsLoadingLogs(false);
    }
  }, [vmId, selectedProject, selectedFile, searchQuery]);

  // Trigger search on Enter key
  const handleSearchKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        handleSearch();
      }
    },
    [handleSearch]
  );

  return (
    <div className="flex flex-col h-full bg-gray-900 border border-gray-700 rounded-lg overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-gray-800 border-b border-gray-700">
        <div className="flex items-center gap-2">
          <svg className="w-5 h-5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <h3 className="text-sm font-semibold text-gray-100">
            Logs — {vmLabel}
          </h3>
        </div>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-200 transition-colors"
          aria-label="Close log viewer"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Controls */}
      <div className="flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center gap-3 px-4 py-3 bg-gray-850 border-b border-gray-700">
        {/* Project selector */}
        <div className="flex items-center gap-2">
          <label htmlFor="log-project-select" className="text-xs text-gray-400 whitespace-nowrap">
            Project:
          </label>
          <select
            id="log-project-select"
            value={selectedProject}
            onChange={(e) => setSelectedProject(e.target.value)}
            disabled={isLoadingProjects}
            className="flex-1 sm:flex-none px-2 py-1.5 text-sm bg-gray-700 border border-gray-600 rounded-md text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 min-w-0"
          >
            <option value="">Select project...</option>
            {projects.map((project) => (
              <option key={project.name} value={project.name}>
                {project.name} ({project.logCount} logs)
              </option>
            ))}
          </select>
        </div>

        {/* File selector */}
        <div className="flex items-center gap-2">
          <label htmlFor="log-file-select" className="text-xs text-gray-400 whitespace-nowrap">
            File:
          </label>
          <select
            id="log-file-select"
            value={selectedFile}
            onChange={(e) => setSelectedFile(e.target.value)}
            disabled={!selectedProject || isLoadingFiles}
            className="flex-1 sm:flex-none px-2 py-1.5 text-sm bg-gray-700 border border-gray-600 rounded-md text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 min-w-0"
          >
            <option value="">Select file...</option>
            {logFiles.map((file) => (
              <option key={file.filename} value={file.filename}>
                {file.filename} ({file.date})
              </option>
            ))}
          </select>
        </div>

        {/* Search input */}
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <div className="relative flex-1 min-w-0">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              placeholder="Search logs..."
              disabled={!selectedProject}
              className="w-full pl-8 pr-3 py-1.5 text-sm bg-gray-700 border border-gray-600 rounded-md text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
            />
            <svg
              className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
          <button
            onClick={handleSearch}
            disabled={!selectedProject || !searchQuery.trim()}
            className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:text-gray-500 rounded-md transition-colors flex-shrink-0"
          >
            Search
          </button>
        </div>
      </div>

      {/* Error display */}
      {error && (
        <div className="px-4 py-2 bg-red-900/30 border-b border-red-800">
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}

      {/* Log entries */}
      <div
        ref={logContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto p-4 font-mono text-xs leading-relaxed"
      >
        {isLoadingProjects && (
          <div className="flex items-center justify-center py-8">
            <p className="text-gray-400 text-sm">Loading projects...</p>
          </div>
        )}

        {isLoadingLogs && (
          <div className="flex items-center justify-center py-8">
            <p className="text-gray-400 text-sm">Loading log entries...</p>
          </div>
        )}

        {!isLoadingProjects && !isLoadingLogs && !selectedProject && (
          <div className="flex items-center justify-center py-8">
            <p className="text-gray-500 text-sm">Select a project to view logs</p>
          </div>
        )}

        {!isLoadingLogs && selectedProject && !selectedFile && logFiles.length > 0 && (
          <div className="flex items-center justify-center py-8">
            <p className="text-gray-500 text-sm">Select a log file to view entries</p>
          </div>
        )}

        {!isLoadingLogs && selectedFile && logEntries.length === 0 && (
          <div className="flex items-center justify-center py-8">
            <p className="text-gray-500 text-sm">No log entries found</p>
          </div>
        )}

        {logEntries.length > 0 && (
          <div className="space-y-0.5">
            {logEntries.map((entry, index) => (
              <div
                key={index}
                className={`flex items-start gap-2 py-0.5 px-2 rounded hover:bg-gray-800/50 ${getLevelColor(entry.level)}`}
              >
                <span
                  className={`inline-block px-1.5 py-0 text-[10px] font-bold uppercase border rounded flex-shrink-0 mt-0.5 ${getLevelBadgeClass(entry.level)}`}
                >
                  {entry.level}
                </span>
                {entry.timestamp && (
                  <span className="text-gray-500 flex-shrink-0 whitespace-nowrap">
                    {entry.timestamp}
                  </span>
                )}
                <span className="break-all">{entry.message}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
