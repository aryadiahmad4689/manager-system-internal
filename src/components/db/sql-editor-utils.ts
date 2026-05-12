/**
 * Utility functions for the SQL Editor component.
 * Extracted for testability since CodeMirror requires a browser environment.
 */

/**
 * Determines if a keyboard event represents the "Run Query" shortcut.
 * - Ctrl+Enter on Windows/Linux
 * - Cmd+Enter on macOS
 */
export function isRunQueryShortcut(event: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
}): boolean {
  return event.key === 'Enter' && (event.ctrlKey || event.metaKey);
}

/**
 * Detects if the current environment is macOS based on navigator.
 * Returns true for macOS, false otherwise.
 */
export function isMacOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  return navigator.platform?.toLowerCase().includes('mac') ?? false;
}

/**
 * Returns the display label for the run query shortcut based on platform.
 */
export function getRunShortcutLabel(): string {
  if (isMacOS()) {
    return '⌘+Enter';
  }
  return 'Ctrl+Enter';
}

/**
 * Detects if dark mode is active by checking the document root for the 'dark' class.
 * This matches the project's Tailwind dark mode strategy.
 */
export function isDarkMode(): boolean {
  if (typeof document === 'undefined') return true; // default to dark in SSR
  return document.documentElement.classList.contains('dark');
}

/**
 * Extracts the selected text from a CodeMirror EditorView selection state.
 * Returns the selected text if there is a non-empty selection, otherwise returns empty string.
 */
export function getSelectedText(selection: { from: number; to: number }, sliceDoc: (from: number, to: number) => string): string {
  const { from, to } = selection;
  if (from === to) return '';
  return sliceDoc(from, to);
}
