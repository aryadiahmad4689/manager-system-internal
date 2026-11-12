'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import Terminal from './Terminal';
import { getTabDisplayTitle, type TerminalTab } from './terminal-utils';

export { getTabDisplayTitle };
export type { TerminalTab };

interface TerminalPanelProps {
  tabs: TerminalTab[];
  activeTabId?: string | null;
  onCloseTab: (tabId: string) => void;
  isSplit?: boolean;
  splitTabId?: string | null;
  focusedPane?: 'left' | 'right';
  onFocusPane?: (pane: 'left' | 'right') => void;
  onSelectTabForPane?: (pane: 'left' | 'right', tabId: string) => void;
}

export default function TerminalPanel({
  tabs,
  activeTabId: externalActiveTabId,
  onCloseTab,
  isSplit = false,
  splitTabId = null,
  focusedPane = 'left',
  onFocusPane,
  onSelectTabForPane,
}: TerminalPanelProps) {
  const [internalActiveTabId, setInternalActiveTabId] = useState<string | null>(
    tabs.length > 0 ? tabs[0].id : null
  );
  const prevTabCountRef = useRef(tabs.length);

  // Use external activeTabId if provided, otherwise use internal
  const activeTabId = externalActiveTabId !== undefined ? externalActiveTabId : internalActiveTabId;

  // When a new tab is added, make it active (only if not externally controlled)
  useEffect(() => {
    if (externalActiveTabId === undefined) {
      if (tabs.length > prevTabCountRef.current && tabs.length > 0) {
        const newestTab = tabs[tabs.length - 1];
        setInternalActiveTabId(newestTab.id);
      }
    }
    prevTabCountRef.current = tabs.length;
  }, [tabs, externalActiveTabId]);

  const handleCloseTab = useCallback((tabId: string) => {
    // If closing the active tab, switch to another (only for internal state)
    if (externalActiveTabId === undefined && activeTabId === tabId) {
      const tabIndex = tabs.findIndex(t => t.id === tabId);
      if (tabs.length > 1) {
        const nextTab = tabs[tabIndex === 0 ? 1 : tabIndex - 1];
        setInternalActiveTabId(nextTab.id);
      } else {
        setInternalActiveTabId(null);
      }
    }
    onCloseTab(tabId);
  }, [activeTabId, tabs, onCloseTab, externalActiveTabId]);

  if (tabs.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col h-full border-t border-gray-700 bg-gray-900">
      {/* Tab bar - only show if not externally controlled */}
      {externalActiveTabId === undefined && (
        <div className="flex items-center bg-gray-800 border-b border-gray-700 overflow-x-auto">
          {tabs.map((tab) => (
            <div
              key={tab.id}
              className={`flex items-center gap-2 px-4 py-2 text-sm cursor-pointer border-r border-gray-700 min-w-0 ${
                activeTabId === tab.id
                  ? 'bg-gray-900 text-gray-100 border-b-2 border-b-blue-500'
                  : 'text-gray-400 hover:text-gray-200 hover:bg-gray-750'
              }`}
              onClick={() => setInternalActiveTabId(tab.id)}
            >
              <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <span className="truncate max-w-[140px]">{getTabDisplayTitle(tab, tabs)}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleCloseTab(tab.id);
                }}
                className="ml-1 text-gray-500 hover:text-gray-200 flex-shrink-0"
                aria-label={`Close terminal for ${tab.vmLabel}`}
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Terminal content area */}
      <div className={`flex-1 relative ${isSplit ? 'grid grid-cols-1 md:grid-cols-2 h-full gap-1.5 p-1.5 bg-gray-950 overflow-hidden' : 'h-full'}`}>
        {tabs.map((tab) => {
          const isLeftActive = activeTabId === tab.id;
          const isRightActive = isSplit && splitTabId === tab.id;
          const isVisible = isSplit ? (isLeftActive || isRightActive) : isLeftActive;

          return (
            <div
              key={tab.id}
              onClick={() => {
                if (isSplit && onFocusPane) {
                  onFocusPane(isLeftActive ? 'left' : 'right');
                }
              }}
              className={`h-full ${isVisible ? 'flex flex-col min-h-0' : 'hidden'} ${
                isSplit
                  ? `relative rounded-md border overflow-hidden ${
                      (isLeftActive && focusedPane === 'left') || (isRightActive && focusedPane === 'right')
                        ? 'border-blue-500/70 shadow-sm shadow-blue-500/20'
                        : 'border-gray-700/70'
                    }`
                  : ''
              }`}
            >
              {/* Split pane header banner */}
              {isSplit && isVisible && (
                <div className="flex items-center justify-between px-2.5 py-1 bg-gray-800/90 border-b border-gray-700 text-xs text-gray-300 flex-shrink-0 select-none">
                  <div className="flex items-center gap-2 truncate">
                    <span
                      className={`inline-flex items-center px-1.5 py-0.2 rounded text-[10px] font-mono font-semibold ${
                        isLeftActive
                          ? 'bg-blue-900/60 text-blue-300 border border-blue-700/50'
                          : 'bg-green-900/60 text-green-300 border border-green-700/50'
                      }`}
                    >
                      {isLeftActive ? 'Pane 1 (Left)' : 'Pane 2 (Right)'}
                    </span>
                    <span className="font-medium text-gray-200 truncate">
                      {getTabDisplayTitle(tab, tabs)}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    {/* Quick tab switcher dropdown for this pane */}
                    {tabs.length > 1 && onSelectTabForPane && (
                      <select
                        value={tab.id}
                        onChange={(e) => onSelectTabForPane(isLeftActive ? 'left' : 'right', e.target.value)}
                        className="bg-gray-900 border border-gray-600 rounded px-1.5 py-0.5 text-[11px] text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
                        title="Ganti tab pada pane ini"
                      >
                        {tabs.map((t) => (
                          <option key={t.id} value={t.id}>
                            {getTabDisplayTitle(t, tabs)}
                          </option>
                        ))}
                      </select>
                    )}

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onCloseTab(tab.id);
                      }}
                      className="text-gray-400 hover:text-red-400 p-1 rounded hover:bg-gray-700 transition-colors"
                      title="Tutup tab ini"
                      aria-label={`Close tab ${tab.vmLabel}`}
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                </div>
              )}

              {/* Terminal view */}
              <div className="flex-1 relative min-h-0">
                <Terminal
                  vmId={tab.vmId}
                  vmLabel={tab.vmLabel}
                  isActive={isVisible}
                  onClose={() => handleCloseTab(tab.id)}
                  pendingCommand={tab.pendingCommand}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
