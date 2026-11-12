export interface TerminalTab {
  id: string;
  vmId: string;
  vmLabel: string;
  pendingCommand?: { command: string; timestamp: number };
}

/**
 * Returns a human-friendly display title for a terminal tab.
 * If multiple tabs belong to the same VM, suffixes them with `#1`, `#2`, etc.
 */
export function getTabDisplayTitle(tab: TerminalTab, allTabs: TerminalTab[]): string {
  const matchingTabs = allTabs.filter((t) => t.vmId === tab.vmId);
  if (matchingTabs.length <= 1) {
    return tab.vmLabel;
  }
  const index = matchingTabs.findIndex((t) => t.id === tab.id);
  return `${tab.vmLabel} #${index >= 0 ? index + 1 : 1}`;
}

