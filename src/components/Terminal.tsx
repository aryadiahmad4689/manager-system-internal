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
  onGitBranchChange?: (branch: string | null) => void;
}

type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'error';

export default function Terminal({ vmId, vmLabel, isActive, onClose, onError, onGitBranchChange }: TerminalProps) {
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
  const [gitBranch, setGitBranch] = useState<string | null>(null);
  const [gitDirectory, setGitDirectory] = useState<string>('');
  const lastSelectedTextRef = useRef('');
  const lastDirRef = useRef<string>(
    typeof window !== 'undefined'
      ? (localStorage.getItem(`terminal-lastdir-${vmId}`) || '')
      : ''
  );
  const gitCheckTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputBufferRef = useRef<string>('');
  const cwdDetectedRef = useRef<boolean>(false);

  const sendCommand = useCallback((command: string) => {
    if (socketRef.current?.connected) {
      socketRef.current.emit('terminal:input', command + '\n');
    }
  }, []);

  const listDirectory = useCallback((dir?: string) => {
    if (socketRef.current?.connected) {
      setLoadingLogs(true);
      socketRef.current.emit('terminal:list-logs', vmId, dir || undefined);
    }
  }, [vmId]);

  const checkGitBranch = useCallback((dir?: string) => {
    if (socketRef.current?.connected) {
      socketRef.current.emit('terminal:check-git', vmId, dir || undefined);
    }
  }, [vmId]);

  const toggleSearchBar = useCallback(() => {
    setShowSearchBar(prev => {
      const next = !prev;
      if (next && connectionState === 'connected') {
        // Load directory listing: use cwd if known, otherwise default (home)
        const cwd = lastDirRef.current || undefined;
        // Only reload if no entries yet, or if cwd changed from what's displayed
        if (dirEntries.length === 0 || (cwd && cwd !== currentDir)) {
          setTimeout(() => listDirectory(cwd), 100);
        }
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
  }, [listDirectory, dirEntries.length, currentDir, connectionState]);
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

          // Track typed input to detect cd commands
          if (data === '\r' || data === '\n') {
            // User pressed Enter — check if they typed a cd command
            const typed = inputBufferRef.current.trim();
            if (typed.startsWith('cd ')) {
              const dir = typed.slice(3).trim().replace(/["']/g, '');
              if (dir && dir !== '-') {
                // Re-check git branch after cd
                if (gitCheckTimerRef.current) {
                  clearTimeout(gitCheckTimerRef.current);
                }
                gitCheckTimerRef.current = setTimeout(() => {
                  socketRef.current?.emit('terminal:check-git', vmId, dir);
                }, 1000);
              }
            }
            inputBufferRef.current = '';
          } else if (data === '\x7f' || data === '\b') {
            // Backspace — remove last char from buffer
            inputBufferRef.current = inputBufferRef.current.slice(0, -1);
          } else if (data.length === 1 && data >= ' ') {
            // Regular printable character
            inputBufferRef.current += data;
          } else if (data.length > 1 && !data.startsWith('\x1b')) {
            // Pasted text
            inputBufferRef.current += data;
          }
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

      // After shell is ready, cd to last known directory if we have one
      const savedDir = lastDirRef.current;
      if (savedDir) {
        // Wait for the first prompt to appear (indicates shell is ready)
        // then send cd + clear so the terminal looks clean
        let prompted = false;
        const promptHandler = (data: string) => {
          // Detect prompt: typically ends with $ or # after user@host:path
          if (!prompted && (data.includes('$') || data.includes('#'))) {
            prompted = true;
            socket.off('terminal:output', promptHandler);
            // Small delay to ensure prompt is fully rendered
            setTimeout(() => {
              socket.emit('terminal:input', `cd ${savedDir} && clear\n`);
            }, 200);
          }
        };
        socket.on('terminal:output', promptHandler);
        // Fallback: if no prompt detected within 5s, try anyway
        setTimeout(() => {
          if (!prompted) {
            socket.off('terminal:output', promptHandler);
            socket.emit('terminal:input', `cd ${savedDir} && clear\n`);
          }
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

      // Check git branch after shell is ready
      setTimeout(() => {
        socket.emit('terminal:check-git', vmId);
      }, 2000);

      // Auto-load directory listing for file browser after shell is ready
      setTimeout(() => {
        const cwd = lastDirRef.current || undefined;
        socket.emit('terminal:list-logs', vmId, cwd);
        setLoadingLogs(true);
      }, 2500);
    });

    socket.on('terminal:output', (data: string) => {
      if (xtermRef.current) {
        xtermRef.current.write(data);
      }

      // Parse prompt to detect current working directory
      // Common prompt formats: user@host:path$ or user@host:path#
      // Example: administrator@172:~/AppGolang/vikendi-go$
      const promptMatch = data.match(/[@\w.-]+:([~\/][^\$#\n\r\x1b]*?)[\$#]\s*$/m);
      if (promptMatch) {
        const detectedPath = promptMatch[1].trim();
        if (detectedPath && detectedPath !== lastDirRef.current) {
          lastDirRef.current = detectedPath;
          try { localStorage.setItem(`terminal-lastdir-${vmId}`, detectedPath); } catch {}
          cwdDetectedRef.current = true;
        }
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

    // Listen for git info response
    socket.on('terminal:git-info', (data: { isGit: boolean; branch: string | null; directory: string }) => {
      if (data.isGit && data.branch) {
        setGitBranch(data.branch);
        setGitDirectory(data.directory);
        onGitBranchChange?.(data.branch);
      } else {
        setGitBranch(null);
        setGitDirectory('');
        onGitBranchChange?.(null);
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

      if (gitCheckTimerRef.current) {
        clearTimeout(gitCheckTimerRef.current);
      }

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
      {/* Search toolbar — always visible */}
      <TerminalSearchBar
        onExecute={sendCommand}
        visible={true}
        onToggle={toggleSearchBar}
        dirEntries={dirEntries}
        currentDir={currentDir}
        loadingLogs={loadingLogs}
        onNavigate={listDirectory}
      />

      {/* Terminal toolbar — only show when there's content */}
      {(selectedText || gitBranch) && (
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
          {gitBranch && (
            <span className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-orange-400 ${!selectedText ? 'mr-auto' : ''}`} title={`Git: ${gitBranch}`}>
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A2 2 0 013 12V7a4 4 0 014-4z" />
              </svg>
              {gitBranch}
            </span>
          )}
        </div>
      )}

      {/* Terminal container */}
      <div
        ref={terminalRef}
        className="flex-1 bg-black"
        style={{ minHeight: '300px' }}
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
