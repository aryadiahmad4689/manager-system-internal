import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  isRunQueryShortcut,
  isMacOS,
  getRunShortcutLabel,
  isDarkMode,
  getSelectedText,
} from '@/components/db/sql-editor-utils';

describe('SQLEditor - isRunQueryShortcut', () => {
  it('should return true for Ctrl+Enter', () => {
    const event = { key: 'Enter', ctrlKey: true, metaKey: false };
    expect(isRunQueryShortcut(event)).toBe(true);
  });

  it('should return true for Cmd+Enter (macOS)', () => {
    const event = { key: 'Enter', ctrlKey: false, metaKey: true };
    expect(isRunQueryShortcut(event)).toBe(true);
  });

  it('should return true when both Ctrl and Meta are pressed', () => {
    const event = { key: 'Enter', ctrlKey: true, metaKey: true };
    expect(isRunQueryShortcut(event)).toBe(true);
  });

  it('should return false for Enter without modifier', () => {
    const event = { key: 'Enter', ctrlKey: false, metaKey: false };
    expect(isRunQueryShortcut(event)).toBe(false);
  });

  it('should return false for Ctrl+Space', () => {
    const event = { key: ' ', ctrlKey: true, metaKey: false };
    expect(isRunQueryShortcut(event)).toBe(false);
  });

  it('should return false for Ctrl+a', () => {
    const event = { key: 'a', ctrlKey: true, metaKey: false };
    expect(isRunQueryShortcut(event)).toBe(false);
  });

  it('should return false for Shift+Enter (no ctrl/meta)', () => {
    const event = { key: 'Enter', ctrlKey: false, metaKey: false };
    expect(isRunQueryShortcut(event)).toBe(false);
  });
});

describe('SQLEditor - isMacOS', () => {
  const originalNavigator = global.navigator;

  afterEach(() => {
    Object.defineProperty(global, 'navigator', {
      value: originalNavigator,
      writable: true,
      configurable: true,
    });
  });

  it('should return false when navigator is undefined', () => {
    Object.defineProperty(global, 'navigator', {
      value: undefined,
      writable: true,
      configurable: true,
    });
    expect(isMacOS()).toBe(false);
  });

  it('should return true for MacIntel platform', () => {
    Object.defineProperty(global, 'navigator', {
      value: { platform: 'MacIntel' },
      writable: true,
      configurable: true,
    });
    expect(isMacOS()).toBe(true);
  });

  it('should return true for macOS platform', () => {
    Object.defineProperty(global, 'navigator', {
      value: { platform: 'macOS' },
      writable: true,
      configurable: true,
    });
    expect(isMacOS()).toBe(true);
  });

  it('should return false for Win32 platform', () => {
    Object.defineProperty(global, 'navigator', {
      value: { platform: 'Win32' },
      writable: true,
      configurable: true,
    });
    expect(isMacOS()).toBe(false);
  });

  it('should return false for Linux platform', () => {
    Object.defineProperty(global, 'navigator', {
      value: { platform: 'Linux x86_64' },
      writable: true,
      configurable: true,
    });
    expect(isMacOS()).toBe(false);
  });
});

describe('SQLEditor - getRunShortcutLabel', () => {
  const originalNavigator = global.navigator;

  afterEach(() => {
    Object.defineProperty(global, 'navigator', {
      value: originalNavigator,
      writable: true,
      configurable: true,
    });
  });

  it('should return ⌘+Enter on macOS', () => {
    Object.defineProperty(global, 'navigator', {
      value: { platform: 'MacIntel' },
      writable: true,
      configurable: true,
    });
    expect(getRunShortcutLabel()).toBe('⌘+Enter');
  });

  it('should return Ctrl+Enter on non-macOS', () => {
    Object.defineProperty(global, 'navigator', {
      value: { platform: 'Win32' },
      writable: true,
      configurable: true,
    });
    expect(getRunShortcutLabel()).toBe('Ctrl+Enter');
  });

  it('should return Ctrl+Enter when navigator is undefined', () => {
    Object.defineProperty(global, 'navigator', {
      value: undefined,
      writable: true,
      configurable: true,
    });
    expect(getRunShortcutLabel()).toBe('Ctrl+Enter');
  });
});

describe('SQLEditor - isDarkMode', () => {
  let originalDocument: typeof global.document;

  beforeEach(() => {
    originalDocument = global.document;
  });

  afterEach(() => {
    Object.defineProperty(global, 'document', {
      value: originalDocument,
      writable: true,
      configurable: true,
    });
  });

  it('should return true when document is undefined (SSR)', () => {
    Object.defineProperty(global, 'document', {
      value: undefined,
      writable: true,
      configurable: true,
    });
    expect(isDarkMode()).toBe(true);
  });

  it('should return true when dark class is present on documentElement', () => {
    Object.defineProperty(global, 'document', {
      value: {
        documentElement: {
          classList: {
            contains: (cls: string) => cls === 'dark',
          },
        },
      },
      writable: true,
      configurable: true,
    });
    expect(isDarkMode()).toBe(true);
  });

  it('should return false when dark class is not present on documentElement', () => {
    Object.defineProperty(global, 'document', {
      value: {
        documentElement: {
          classList: {
            contains: (_cls: string) => false,
          },
        },
      },
      writable: true,
      configurable: true,
    });
    expect(isDarkMode()).toBe(false);
  });
});


describe('SQLEditor - getSelectedText', () => {
  const fullText = 'SELECT * FROM users;\nSELECT * FROM orders;';

  const sliceDoc = (from: number, to: number) => fullText.slice(from, to);

  it('should return empty string when nothing is selected (from === to)', () => {
    expect(getSelectedText({ from: 0, to: 0 }, sliceDoc)).toBe('');
  });

  it('should return empty string when cursor is at end with no selection', () => {
    expect(getSelectedText({ from: 10, to: 10 }, sliceDoc)).toBe('');
  });

  it('should return selected text when a range is selected', () => {
    // Select "SELECT * FROM users;"
    expect(getSelectedText({ from: 0, to: 20 }, sliceDoc)).toBe('SELECT * FROM users;');
  });

  it('should return partial selection correctly', () => {
    // Select "FROM users"
    expect(getSelectedText({ from: 9, to: 19 }, sliceDoc)).toBe('FROM users');
  });

  it('should handle multi-line selection', () => {
    // Select entire text
    expect(getSelectedText({ from: 0, to: fullText.length }, sliceDoc)).toBe(fullText);
  });

  it('should return second line when selected', () => {
    // Select "SELECT * FROM orders;"
    expect(getSelectedText({ from: 21, to: 42 }, sliceDoc)).toBe('SELECT * FROM orders;');
  });
});
