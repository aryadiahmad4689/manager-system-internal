'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { io, Socket } from 'socket.io-client';
import TerminalSearchBar from './TerminalSearchBar';
import AIAnalyzeModal from './AIAnalyzeModal';
import PrettifyModal from './PrettifyModal';
import '@xterm/xterm/css/xterm.css';

interface TerminalProps {
  vmId: string;
  vmLabel: string;
  isActive: boolean;
  onClose: () => void;
  onError?: (message: string) => void;
}

type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'error';

export default function Terminal({ vmId, vmLabel, isActive, onClose, onError }: TerminalProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [showSearchBar, setShowSearchBar] = useState(false);
  const [dirEntries, setDirEntries] = useState<{ name: string; isDir: boolean; path: string }[]>([]);
  const [currentDir, setCurrentDir] = useState('');
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [selectedText, setSelectedText] = useState('');
  const [showAIAnalyze, setShowAIAnalyze] = useState(false);
  const [showPrettify, setShowPrettify] = useState(false);
  const lastSelectedTextRef = useRef('');
  const lastDirRef = useRef('');

  const sendCommand = useCallback((command: string) => {
    if (socketRef.current?.connected) {
      socketRef.current.emit('terminal:input', command + '\n');

      // Track cd commands — only absolute paths are reliable
      const trimmed = command.trim();
      if (trimmed.startsWith('cd ')) {
        const dir = trimmed.slice(3).trim().replace(/["']/g, '');
        if (dir.startsWith('/')) {
          lastDirRef.current = dir;
        }
      }
    }
  }, []);

  const listDirectory = useCallback((dir?: string) => {
    if (socketRef.current?.connected) {
      setLoadingLogs(true);
      socketRef.current.emit('terminal:list-logs', vmId, dir || undefined);
    }
  }, [vmId]);

  const toggleSearchBar = useCallback(() => {
    setShowSearchBar(prev => {
      const next = !prev;
      if (next && dirEntries.length === 0) {
        // First open — load home directory (where shell starts)
        setTimeout(() => listDirectory(), 100);
      }
      return next;
    });
    setTimeout(() => {
      if (fitAddonRef.current && xtermRef.current) {
        try {
          fitAddonRef.current.fit();
        } catch {
          // Ignore
        }
      }
    }, 50);
  }, [dirEntries.length, listDirectory]);
  const connect = useCallback(() => {
    setConnectionState('connecting');
    setErrorMessage('');

    // Initialize xterm.js
    if (!xtermRef.current && terminalRef.current) {
      const term = new XTerm({
        cursorBlink: true,
        theme: {
          background: '#000000',
          foreground: '#ffffff',
          cursor: '#ffffff',
        },
        fontSize: 14,
        fontFamily: 'Menlo, Monaco, "Courier New", monospace',
        allowProposedApi: true,
      });

      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.open(terminalRef.current);
      fitAddon.fit();

      // Register input handler — only once when xterm is created
      term.onData((data: string) => {
        if (socketRef.current?.connected) {
          socketRef.current.emit('terminal:input', data);
        }
      });

      // Detect text selection
      term.onSelectionChange(() => {
        const selection = term.getSelection() || '';
        setSelectedText(selection);
      });

      xtermRef.current = term;
      fitAddonRef.current = fitAddon;
    }

    // Connect Socket.IO
    const socket = io({
      path: '/api/socketio',
      transports: ['websocket', 'polling'],
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      setConnectionState('connected');

      // Get current terminal size and send with open request
      let initialSize = { cols: 80, rows: 24 };
      if (fitAddonRef.current && xtermRef.current) {
        try {
          fitAddonRef.current.fit();
          initialSize = { cols: xtermRef.current.cols, rows: xtermRef.current.rows };
        } catch {
          // use defaults
        }
      }

      socket.emit('terminal:open', vmId, initialSize);

      // After shell is ready, cd to last known directory
      if (lastDirRef.current) {
        const savedDir = lastDirRef.current;
        // Wait for first output (shell prompt ready) then cd
        const cdHandler = () => {
          socket.off('terminal:output', cdHandler);
          setTimeout(() => {
            socket.emit('terminal:input', `cd ${savedDir}\n`);
          }, 300);
        };
        socket.on('terminal:output', cdHandler);
        // Fallback in case no output comes
        setTimeout(() => {
          socket.off('terminal:output', cdHandler);
        }, 5000);
      }

      // Send resize again after shell is fully ready
      const sendResize = () => {
        if (fitAddonRef.current && xtermRef.current) {
          try {
            fitAddonRef.current.fit();
            const { cols, rows } = xtermRef.current;
            socket.emit('terminal:resize', cols, rows);
          } catch {
            // ignore
          }
        }
      };
      setTimeout(sendResize, 1000);
    });

    socket.on('terminal:output', (data: string) => {
      if (xtermRef.current) {
        xtermRef.current.write(data);
      }
    });

    socket.on('terminal:error', (message: string) => {
      setConnectionState('error');
      setErrorMessage(message);
      if (onError) {
        onError(message);
      }
    });

    socket.on('terminal:close', () => {
      setConnectionState('disconnected');
    });

    socket.on('connect_error', (err) => {
      setConnectionState('error');
      setErrorMessage(err.message || 'Failed to connect to server');
    });

    socket.on('disconnect', (reason) => {
      if (reason !== 'io client disconnect') {
        setConnectionState('disconnected');
      }
    });

    // Listen for log file list response
    socket.on('terminal:log-files', (data: { directory: string; entries: { name: string; isDir: boolean; path: string }[] }) => {
      setDirEntries(data.entries);
      setCurrentDir(data.directory);
      setLoadingLogs(false);
      // Track directory for reconnect
      if (data.directory) {
        lastDirRef.current = data.directory;
      }
    });

    // Forward xterm input to server — only register once during xterm initialization
    // (moved to after xterm creation above to avoid duplicate listeners on reconnect)
  }, [vmId, onError]);

  const disconnect = useCallback(() => {
    if (socketRef.current) {
      socketRef.current.emit('terminal:close');
      socketRef.current.disconnect();
      socketRef.current = null;
    }
  }, []);

  const retry = useCallback(() => {
    disconnect();
    // Clear the terminal
    if (xtermRef.current) {
      xtermRef.current.clear();
    }
    connect();
  }, [disconnect, connect]);

  // Initialize terminal and connect on mount
  useEffect(() => {
    connect();

    return () => {
      // Cleanup on unmount
      disconnect();

      if (resizeObserverRef.current) {
        resizeObserverRef.current.disconnect();
        resizeObserverRef.current = null;
      }

      if (xtermRef.current) {
        xtermRef.current.dispose();
        xtermRef.current = null;
      }

      fitAddonRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Handle resize with ResizeObserver
  useEffect(() => {
    if (!terminalRef.current || !fitAddonRef.current) return;

    const observer = new ResizeObserver(() => {
      if (fitAddonRef.current && xtermRef.current && isActive) {
        try {
          fitAddonRef.current.fit();
          const { cols, rows } = xtermRef.current;
          if (socketRef.current?.connected) {
            socketRef.current.emit('terminal:resize', cols, rows);
          }
        } catch {
          // Ignore resize errors during transitions
        }
      }
    });

    observer.observe(terminalRef.current);
    resizeObserverRef.current = observer;

    return () => {
      observer.disconnect();
    };
  }, [isActive]);

  // Re-fit when tab becomes active
  useEffect(() => {
    if (isActive && fitAddonRef.current && xtermRef.current) {
      setTimeout(() => {
        try {
          fitAddonRef.current?.fit();
          if (xtermRef.current && socketRef.current?.connected) {
            const { cols, rows } = xtermRef.current;
            socketRef.current.emit('terminal:resize', cols, rows);
          }
        } catch {
          // Ignore
        }
      }, 50);
    }
  }, [isActive]);

  // Keyboard shortcut: Ctrl+Shift+F to toggle search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'F' && isActive) {
        e.preventDefault();
        toggleSearchBar();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isActive, toggleSearchBar]);

  return (
    <div className={`flex flex-col h-full ${isActive ? '' : 'hidden'}`}>
      {/* Search toolbar */}
      <TerminalSearchBar
        onExecute={sendCommand}
        visible={showSearchBar}
        onToggle={toggleSearchBar}
        dirEntries={dirEntries}
        currentDir={currentDir}
        loadingLogs={loadingLogs}
        onNavigate={listDirectory}
      />

      {/* Terminal toolbar */}
      <div className="flex items-center justify-end px-2 py-1 bg-gray-800 border-b border-gray-700 gap-1">
        {/* Buttons that show when text is selected */}
        {selectedText && (
          <div className="flex items-center gap-1 mr-auto">
            <button
              onClick={() => setShowPrettify(true)}
              className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded transition-colors bg-green-600 hover:bg-green-700 text-white"
              title="Format & prettify selected text"
            >
              <span className="text-sm">✨</span>
              Prettify
            </button>
            <button
              onClick={() => setShowAIAnalyze(true)}
              className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded transition-colors bg-purple-600 hover:bg-purple-700 text-white"
              title="Analyze selected text with AI"
            >
              <span>🤖</span>
              AI Analyze
            </button>
          </div>
        )}
        <button
          onClick={toggleSearchBar}
          className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded transition-colors ${
            showSearchBar
              ? 'bg-blue-600 text-white'
              : 'text-gray-400 hover:text-gray-200 hover:bg-gray-700'
          }`}
          title="Search Commands (Ctrl+Shift+F)"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          Search
        </button>
      </div>

      {/* Terminal container */}
      <div
        ref={terminalRef}
        className="flex-1 bg-black"
        style={{ minHeight: '200px' }}
      />

      {/* Connection state overlays */}
      {connectionState === 'connecting' && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80 z-10">
          <div className="text-center">
            <div className="animate-spin w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full mx-auto mb-3" />
            <p className="text-gray-300 text-sm">Connecting to {vmLabel}...</p>
          </div>
        </div>
      )}

      {connectionState === 'error' && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80 z-10">
          <div className="text-center max-w-sm px-4">
            <svg className="w-12 h-12 text-red-500 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
            <p className="text-red-400 font-medium mb-2">Connection Error</p>
            <p className="text-gray-400 text-sm mb-4">{errorMessage}</p>
            <div className="flex gap-3 justify-center">
              <button
                onClick={retry}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors"
              >
                Retry
              </button>
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-gray-300 bg-gray-700 hover:bg-gray-600 rounded-md transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {connectionState === 'disconnected' && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80 z-10">
          <div className="text-center max-w-sm px-4">
            <svg className="w-12 h-12 text-yellow-500 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            <p className="text-yellow-400 font-medium mb-2">Disconnected</p>
            <p className="text-gray-400 text-sm mb-4">The terminal session has ended.</p>
            <div className="flex gap-3 justify-center">
              <button
                onClick={retry}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors"
              >
                Reconnect
              </button>
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-gray-300 bg-gray-700 hover:bg-gray-600 rounded-md transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* AI Analyze Modal */}
      <AIAnalyzeModal
        isOpen={showAIAnalyze}
        onClose={() => setShowAIAnalyze(false)}
        logText={selectedText}
      />

      {/* Prettify Modal */}
      <PrettifyModal
        isOpen={showPrettify}
        onClose={() => setShowPrettify(false)}
        rawText={selectedText}
      />
    </div>
  );
}
