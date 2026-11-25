'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { io, Socket } from 'socket.io-client';
import '@xterm/xterm/css/xterm.css';

export interface OcpTerminalTab {
  id: string;
  clusterId: string;
  clusterLabel: string;
  namespace: string;
  podName: string;
  containers: string[];
  container: string;
  shell: '/bin/sh' | '/bin/bash';
}

interface OcpPodTerminalProps {
  tab: OcpTerminalTab;
  isActive: boolean;
  onChangeTabConfig: (
    tabId: string,
    patch: Partial<Pick<OcpTerminalTab, 'container' | 'shell'>>
  ) => void;
}

function OcpPodTerminal({
  tab,
  isActive,
  onChangeTabConfig,
}: OcpPodTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const [status, setStatus] = useState<'connecting' | 'connected' | 'disconnected' | 'error'>('connecting');
  const [errorMsg, setErrorMsg] = useState('');
  const [reconnectSeq, setReconnectSeq] = useState(0);

  const fitAndResize = useCallback(() => {
    if (!fitAddonRef.current || !xtermRef.current) return;
    try {
      fitAddonRef.current.fit();
      if (socketRef.current?.connected) {
        socketRef.current.emit(
          'ocp:exec:resize',
          xtermRef.current.cols,
          xtermRef.current.rows
        );
      }
    } catch {
      // Ignore fit errors while container is hidden
    }
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;

    setStatus('connecting');
    setErrorMsg('');

    const term = new XTerm({
      cursorBlink: true,
      theme: {
        background: '#000000',
        foreground: '#ffffff',
        cursor: '#ffffff',
      },
      fontSize: 13,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);
    try {
      fitAddon.fit();
    } catch {
      // ignore initial fit if hidden
    }

    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

    const socket = io({
      path: '/api/socketio',
      transports: ['websocket', 'polling'],
    });
    socketRef.current = socket;

    const inputDispose = term.onData((data: string) => {
      if (socket.connected) {
        socket.emit('ocp:exec:input', data);
      }
    });

    socket.on('connect', () => {
      setStatus('connecting');
      let cols = 80;
      let rows = 24;
      try {
        fitAddon.fit();
        cols = term.cols || 80;
        rows = term.rows || 24;
      } catch {
        // use defaults
      }

      socket.emit('ocp:exec:open', {
        clusterId: tab.clusterId,
        namespace: tab.namespace,
        podName: tab.podName,
        container: tab.container || undefined,
        shell: tab.shell,
        cols,
        rows,
      });
    });

    socket.on('ocp:exec:ready', () => {
      setStatus('connected');
      term.focus();
    });

    socket.on('ocp:exec:output', (data: string) => {
      setStatus('connected');
      term.write(data);
    });

    socket.on('ocp:exec:error', (msg: string) => {
      setStatus('error');
      setErrorMsg(msg);
      term.writeln(`\r\n\x1b[31m[OCP Exec Error] ${msg}\x1b[0m`);
    });

    socket.on('ocp:exec:close', () => {
      setStatus('disconnected');
      term.writeln('\r\n\x1b[33m[Session closed]\x1b[0m');
    });

    socket.on('connect_error', (err) => {
      setStatus('error');
      setErrorMsg(err.message);
    });

    const observer = new ResizeObserver(() => {
      fitAndResize();
    });
    observer.observe(containerRef.current);

    return () => {
      observer.disconnect();
      inputDispose.dispose();
      socket.emit('ocp:exec:close');
      socket.disconnect();
      term.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
      socketRef.current = null;
    };
  }, [
    tab.clusterId,
    tab.namespace,
    tab.podName,
    tab.container,
    tab.shell,
    reconnectSeq,
    fitAndResize,
  ]);

  useEffect(() => {
    if (isActive) {
      const timer = setTimeout(() => {
        fitAndResize();
        xtermRef.current?.focus();
      }, 60);
      return () => clearTimeout(timer);
    }
  }, [isActive, fitAndResize]);

  const badgeColor =
    status === 'connected'
      ? 'bg-emerald-500'
      : status === 'connecting'
      ? 'bg-yellow-500'
      : status === 'error'
      ? 'bg-red-500'
      : 'bg-gray-500';

  return (
    <div className="flex flex-col h-full">
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5 bg-gray-900 border-b border-gray-800 text-xs text-gray-300">
        <div className="flex items-center gap-2">
          <span className={`inline-block w-2 h-2 rounded-full ${badgeColor}`} />
          <span className="font-mono text-gray-200">
            {tab.namespace}/{tab.podName}
          </span>
          <span className="text-gray-500">({status})</span>
          {errorMsg && <span className="text-red-400 truncate max-w-md">{errorMsg}</span>}
        </div>

        <div className="flex items-center gap-2">
          {tab.containers.length > 1 && (
            <select
              value={tab.container}
              onChange={(e) => onChangeTabConfig(tab.id, { container: e.target.value })}
              className="px-2 py-0.5 bg-gray-800 border border-gray-700 rounded text-xs text-gray-200"
              aria-label="Pod container"
            >
              {tab.containers.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          )}
          <select
            value={tab.shell}
            onChange={(e) =>
              onChangeTabConfig(tab.id, {
                shell: e.target.value as '/bin/sh' | '/bin/bash',
              })
            }
            className="px-2 py-0.5 bg-gray-800 border border-gray-700 rounded text-xs text-gray-200"
            aria-label="Shell"
          >
            <option value="/bin/sh">/bin/sh</option>
            <option value="/bin/bash">/bin/bash</option>
          </select>
          <button
            type="button"
            onClick={() => setReconnectSeq((n) => n + 1)}
            className="px-2 py-0.5 rounded bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-200"
          >
            Reconnect
          </button>
        </div>
      </div>

      <div ref={containerRef} className="flex-1 min-h-0 bg-black p-1" />
    </div>
  );
}

interface OcpTerminalPanelProps {
  tabs: OcpTerminalTab[];
  activeTabId: string | null;
  onSelectTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onChangeTabConfig: (
    tabId: string,
    patch: Partial<Pick<OcpTerminalTab, 'container' | 'shell'>>
  ) => void;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
}

export default function OcpTerminalPanel({
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  onChangeTabConfig,
  isFullscreen,
  onToggleFullscreen,
}: OcpTerminalPanelProps) {
  if (tabs.length === 0) return null;

  return (
    <div
      className={
        isFullscreen
          ? 'fixed inset-0 z-50 flex flex-col bg-gray-950'
          : 'flex flex-col h-80 border border-gray-700 rounded-xl overflow-hidden bg-gray-950 shadow-xl'
      }
    >
      {/* Tab header */}
      <div className="flex items-center justify-between bg-gray-900 border-b border-gray-800 px-2">
        <div className="flex items-center overflow-x-auto">
          {tabs.map((tab) => {
            const active = tab.id === activeTabId;
            return (
              <div
                key={tab.id}
                onClick={() => onSelectTab(tab.id)}
                className={`flex items-center gap-2 px-3 py-2 text-xs cursor-pointer border-r border-gray-800 ${
                  active
                    ? 'bg-gray-950 text-white border-b-2 border-b-red-500'
                    : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                <span className="font-mono truncate max-w-[180px]">{tab.podName}</span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onCloseTab(tab.id);
                  }}
                  className="text-gray-500 hover:text-gray-200"
                  aria-label={`Close terminal ${tab.podName}`}
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>

        <button
          type="button"
          onClick={onToggleFullscreen}
          className="px-2.5 py-1 text-xs text-gray-300 hover:text-white bg-gray-800 hover:bg-gray-700 rounded my-1"
        >
          {isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
        </button>
      </div>

      {/* Terminal Panes */}
      <div className="flex-1 relative min-h-0">
        {tabs.map((tab) => {
          const active = tab.id === activeTabId;
          return (
            <div
              key={tab.id}
              className={active ? 'h-full w-full' : 'hidden'}
            >
              <OcpPodTerminal
                tab={tab}
                isActive={active}
                onChangeTabConfig={onChangeTabConfig}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
