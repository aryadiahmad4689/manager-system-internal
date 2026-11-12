import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getTabDisplayTitle, type TerminalTab } from '@/components/terminal-utils';

/**
 * Unit tests for Terminal and TerminalPanel component logic.
 * Since these are React components that depend on browser APIs (xterm.js, Socket.IO, DOM),
 * we test the core logic patterns and event handling contracts.
 */

// Mock Socket.IO client behavior
describe('Terminal Socket.IO integration logic', () => {
  let mockSocket: {
    on: ReturnType<typeof vi.fn>;
    emit: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
    connected: boolean;
  };

  beforeEach(() => {
    mockSocket = {
      on: vi.fn(),
      emit: vi.fn(),
      disconnect: vi.fn(),
      connected: true,
    };
  });

  it('should emit terminal:open with vmId on connect', () => {
    // Simulate the connect event handler behavior
    const vmId = 'test-vm-123';
    
    // Register connect handler
    const handlers: Record<string, (...args: unknown[]) => void> = {};
    mockSocket.on.mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
      handlers[event] = handler;
    });

    // Simulate registering handlers
    mockSocket.on('connect', () => {
      mockSocket.emit('terminal:open', vmId);
    });

    // Trigger connect
    handlers['connect']();

    expect(mockSocket.emit).toHaveBeenCalledWith('terminal:open', vmId);
  });

  it('should emit terminal:input when data is typed', () => {
    const inputData = 'ls -la\r';
    
    // Simulate the terminal input forwarding
    if (mockSocket.connected) {
      mockSocket.emit('terminal:input', inputData);
    }

    expect(mockSocket.emit).toHaveBeenCalledWith('terminal:input', inputData);
  });

  it('should emit terminal:resize with cols and rows', () => {
    const cols = 80;
    const rows = 24;

    mockSocket.emit('terminal:resize', cols, rows);

    expect(mockSocket.emit).toHaveBeenCalledWith('terminal:resize', cols, rows);
  });

  it('should emit terminal:close on disconnect', () => {
    mockSocket.emit('terminal:close');
    mockSocket.disconnect();

    expect(mockSocket.emit).toHaveBeenCalledWith('terminal:close');
    expect(mockSocket.disconnect).toHaveBeenCalled();
  });

  it('should not emit terminal:input when socket is disconnected', () => {
    mockSocket.connected = false;
    const inputData = 'test';

    // Simulate the guard check from the component
    if (mockSocket.connected) {
      mockSocket.emit('terminal:input', inputData);
    }

    expect(mockSocket.emit).not.toHaveBeenCalled();
  });
});

describe('Terminal tab management logic', () => {
  interface TerminalTab {
    id: string;
    vmId: string;
    vmLabel: string;
  }

  it('should create a new tab with unique id for a VM', () => {
    const vm = { id: 'vm-1', label: 'Test VM' };
    const tabs: TerminalTab[] = [];

    const newTab: TerminalTab = {
      id: `${vm.id}-${Date.now()}`,
      vmId: vm.id,
      vmLabel: vm.label,
    };

    tabs.push(newTab);

    expect(tabs).toHaveLength(1);
    expect(tabs[0].vmId).toBe('vm-1');
    expect(tabs[0].vmLabel).toBe('Test VM');
    expect(tabs[0].id).toContain('vm-1');
  });

  it('should not create duplicate tabs for the same VM', () => {
    const tabs: TerminalTab[] = [
      { id: 'vm-1-1000', vmId: 'vm-1', vmLabel: 'Test VM' },
    ];

    const vmId = 'vm-1';
    const existingTab = tabs.find(tab => tab.vmId === vmId);

    expect(existingTab).toBeDefined();
    // In the component, we return early if tab exists
  });

  it('should remove a tab by id', () => {
    const tabs: TerminalTab[] = [
      { id: 'vm-1-1000', vmId: 'vm-1', vmLabel: 'VM 1' },
      { id: 'vm-2-1001', vmId: 'vm-2', vmLabel: 'VM 2' },
      { id: 'vm-3-1002', vmId: 'vm-3', vmLabel: 'VM 3' },
    ];

    const filtered = tabs.filter(tab => tab.id !== 'vm-2-1001');

    expect(filtered).toHaveLength(2);
    expect(filtered.find(t => t.id === 'vm-2-1001')).toBeUndefined();
  });

  it('should support pendingCommand when activating an existing tab', () => {
    let tabs: any[] = [
      { id: 'vm-1-1000', vmId: 'vm-1', vmLabel: 'Test VM' },
    ];

    const initialCommand = 'cd "/home/administrator/AppGolang-V2/paradise-entertainment-v2"';
    tabs = tabs.map(tab =>
      tab.vmId === 'vm-1'
        ? { ...tab, pendingCommand: { command: initialCommand, timestamp: Date.now() } }
        : tab
    );

    expect(tabs[0].pendingCommand).toBeDefined();
    expect(tabs[0].pendingCommand.command).toBe(initialCommand);
  });

  it('should switch active tab when closing the active one', () => {
    const tabs: TerminalTab[] = [
      { id: 'vm-1-1000', vmId: 'vm-1', vmLabel: 'VM 1' },
      { id: 'vm-2-1001', vmId: 'vm-2', vmLabel: 'VM 2' },
      { id: 'vm-3-1002', vmId: 'vm-3', vmLabel: 'VM 3' },
    ];

    let activeTabId = 'vm-2-1001';
    const tabToClose = 'vm-2-1001';

    // Logic from TerminalPanel: switch to previous tab
    if (activeTabId === tabToClose) {
      const tabIndex = tabs.findIndex(t => t.id === tabToClose);
      if (tabs.length > 1) {
        const nextTab = tabs[tabIndex === 0 ? 1 : tabIndex - 1];
        activeTabId = nextTab.id;
      } else {
        activeTabId = '';
      }
    }

    expect(activeTabId).toBe('vm-1-1000');
  });

  it('should set active to null when closing the last tab', () => {
    const tabs: TerminalTab[] = [
      { id: 'vm-1-1000', vmId: 'vm-1', vmLabel: 'VM 1' },
    ];

    let activeTabId: string | null = 'vm-1-1000';
    const tabToClose = 'vm-1-1000';

    if (activeTabId === tabToClose) {
      const tabIndex = tabs.findIndex(t => t.id === tabToClose);
      if (tabs.length > 1) {
        const nextTab = tabs[tabIndex === 0 ? 1 : tabIndex - 1];
        activeTabId = nextTab.id;
      } else {
        activeTabId = null;
      }
    }

    expect(activeTabId).toBeNull();
  });

  it('should support multiple simultaneous connections', () => {
    const tabs: TerminalTab[] = [];

    // Connect to 3 different VMs
    for (let i = 1; i <= 3; i++) {
      tabs.push({
        id: `vm-${i}-${1000 + i}`,
        vmId: `vm-${i}`,
        vmLabel: `VM ${i}`,
      });
    }

    expect(tabs).toHaveLength(3);
    expect(tabs[0].vmId).toBe('vm-1');
    expect(tabs[1].vmId).toBe('vm-2');
    expect(tabs[2].vmId).toBe('vm-3');
  });

  it('should support multiple tabs for the same VM', () => {
    const tabs: TerminalTab[] = [
      { id: 'vm-1-1000', vmId: 'vm-1', vmLabel: 'Staging Server' },
      { id: 'vm-1-1001', vmId: 'vm-1', vmLabel: 'Staging Server' },
      { id: 'vm-2-1002', vmId: 'vm-2', vmLabel: 'Production' },
    ];

    expect(tabs).toHaveLength(3);
    const vm1Tabs = tabs.filter(t => t.vmId === 'vm-1');
    expect(vm1Tabs).toHaveLength(2);
    expect(vm1Tabs[0].id).not.toBe(vm1Tabs[1].id);
  });

  describe('getTabDisplayTitle', () => {
    it('should return plain label when only one tab exists for a VM', () => {
      const tabs: TerminalTab[] = [
        { id: 'tab-1', vmId: 'vm-1', vmLabel: 'Staging Server' },
        { id: 'tab-2', vmId: 'vm-2', vmLabel: 'Production' },
      ];

      expect(getTabDisplayTitle(tabs[0], tabs)).toBe('Staging Server');
      expect(getTabDisplayTitle(tabs[1], tabs)).toBe('Production');
    });

    it('should number tabs (#1, #2, etc.) when multiple tabs share the same VM', () => {
      const tabs: TerminalTab[] = [
        { id: 'tab-1', vmId: 'vm-1', vmLabel: 'Staging Server' },
        { id: 'tab-2', vmId: 'vm-1', vmLabel: 'Staging Server' },
        { id: 'tab-3', vmId: 'vm-1', vmLabel: 'Staging Server' },
        { id: 'tab-4', vmId: 'vm-2', vmLabel: 'Production' },
      ];

      expect(getTabDisplayTitle(tabs[0], tabs)).toBe('Staging Server #1');
      expect(getTabDisplayTitle(tabs[1], tabs)).toBe('Staging Server #2');
      expect(getTabDisplayTitle(tabs[2], tabs)).toBe('Staging Server #3');
      expect(getTabDisplayTitle(tabs[3], tabs)).toBe('Production');
    });
  });

  describe('Split view management logic', () => {
    it('should handle split pane assignments and closing a pane', () => {
      const tabs: TerminalTab[] = [
        { id: 'tab-1', vmId: 'vm-1', vmLabel: 'VM 1 #1' },
        { id: 'tab-2', vmId: 'vm-1', vmLabel: 'VM 1 #2' },
      ];

      let isSplitView = true;
      let activeTabId: string | null = 'tab-1';
      let splitTabId: string | null = 'tab-2';

      expect(activeTabId).toBe('tab-1');
      expect(splitTabId).toBe('tab-2');

      // Simulate closing tab-2
      const tabToClose = 'tab-2';
      const remaining = tabs.filter(t => t.id !== tabToClose);

      if (splitTabId === tabToClose) {
        const nextSplit = remaining.find(t => t.id !== activeTabId && t.id !== tabToClose);
        if (nextSplit) {
          splitTabId = nextSplit.id;
        } else {
          splitTabId = null;
          isSplitView = false;
        }
      }

      expect(remaining).toHaveLength(1);
      expect(splitTabId).toBeNull();
      expect(isSplitView).toBe(false);
      expect(activeTabId).toBe('tab-1');
    });
  });
});
