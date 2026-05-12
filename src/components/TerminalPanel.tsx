'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import Terminal from './Terminal';

export interface TerminalTab {
  id: string;
  vmId: string;
  vmLabel: string;
}

interface TerminalPanelProps {
  tabs: TerminalTab[];
  activeTabId?: string | null;
  onCloseTab: (tabId: string) => void;
}

export default function TerminalPanel({ tabs, activeTabId: externalActiveTabId, onCloseTab }: TerminalPanelProps) {
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
              <span className="truncate max-w-[120px]">{tab.vmLabel}</span>
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
      <div className="flex-1 relative">
        {tabs.map((tab) => (
          <Terminal
            key={tab.id}
            vmId={tab.vmId}
            vmLabel={tab.vmLabel}
            isActive={activeTabId === tab.id}
            onClose={() => handleCloseTab(tab.id)}
          />
        ))}
      </div>
    </div>
  );
}
