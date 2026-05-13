'use client';

import { useRef, useEffect, useCallback } from 'react';
import { EditorState, Compartment } from '@codemirror/state';
import { EditorView, keymap, placeholder as cmPlaceholder } from '@codemirror/view';
import { sql, MySQL, MariaSQL } from '@codemirror/lang-sql';
import type { SQLNamespace } from '@codemirror/lang-sql';
import { basicSetup } from 'codemirror';
import { isRunQueryShortcut, getRunShortcutLabel, isDarkMode } from './sql-editor-utils';

export interface SQLEditorProps {
  value: string;
  onChange: (value: string) => void;
  /** Called with the selected text when running a query. If nothing is selected, called with empty string. */
  onRun: (selectedText: string) => void;
  disabled?: boolean;
  placeholder?: string;
  /** Schema for autocomplete: nested object { db: { table: [columns] } } */
  schema?: SQLNamespace;
}

/**
 * Dark theme for CodeMirror that matches the dashboard's Tailwind dark mode.
 */
const darkTheme = EditorView.theme(
  {
    '&': {
      backgroundColor: '#1f2937', // gray-800
      color: '#f3f4f6', // gray-100
    },
    '.cm-content': {
      caretColor: '#60a5fa', // blue-400
    },
    '.cm-cursor, .cm-dropCursor': {
      borderLeftColor: '#60a5fa',
    },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
      backgroundColor: '#1e40af !important', // blue-800 - visible selection in both focused and unfocused
    },
    '.cm-content ::selection': {
      backgroundColor: '#1e40af', // blue-800 - native selection color
    },
    '.cm-gutters': {
      backgroundColor: '#111827', // gray-900
      color: '#6b7280', // gray-500
      border: 'none',
    },
    '.cm-activeLineGutter': {
      backgroundColor: '#1f2937', // gray-800
    },
    '.cm-activeLine': {
      backgroundColor: '#374151', // gray-700
    },
  },
  { dark: true }
);

/**
 * Light theme for CodeMirror that matches the dashboard's Tailwind light mode.
 */
const lightTheme = EditorView.theme(
  {
    '&': {
      backgroundColor: '#f9fafb', // gray-50
      color: '#111827', // gray-900
    },
    '.cm-content': {
      caretColor: '#2563eb', // blue-600
    },
    '.cm-cursor, .cm-dropCursor': {
      borderLeftColor: '#2563eb',
    },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
      backgroundColor: '#bfdbfe !important', // blue-200 - visible selection in both focused and unfocused
    },
    '.cm-content ::selection': {
      backgroundColor: '#bfdbfe', // blue-200 - native selection color
    },
    '.cm-gutters': {
      backgroundColor: '#f3f4f6', // gray-100
      color: '#6b7280', // gray-500
      border: 'none',
    },
    '.cm-activeLineGutter': {
      backgroundColor: '#e5e7eb', // gray-200
    },
    '.cm-activeLine': {
      backgroundColor: '#f3f4f6', // gray-100
    },
  },
  { dark: false }
);

export default function SQLEditor({
  value,
  onChange,
  onRun,
  disabled = false,
  placeholder,
  schema,
}: SQLEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onRunRef = useRef(onRun);
  const onChangeRef = useRef(onChange);
  const sqlCompartment = useRef(new Compartment());
  // Store the last known selection so it persists even when editor loses focus
  const lastSelectionRef = useRef<{ from: number; to: number }>({ from: 0, to: 0 });

  // Keep refs up to date
  useEffect(() => {
    onRunRef.current = onRun;
  }, [onRun]);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  // Initialize CodeMirror
  useEffect(() => {
    if (!editorRef.current) return;

    const dark = isDarkMode();

    const runQueryKeymap = keymap.of([
      {
        key: 'Ctrl-Enter',
        mac: 'Cmd-Enter',
        run: (view) => {
          const { from, to } = view.state.selection.main;
          const selectedText = from !== to ? view.state.sliceDoc(from, to) : '';
          onRunRef.current(selectedText);
          return true;
        },
      },
    ]);

    const extensions = [
      basicSetup,
      sqlCompartment.current.of(sql({ dialect: MySQL, schema: schema || undefined })),
      runQueryKeymap,
      dark ? darkTheme : lightTheme,
      // Force selection to be visible with high-specificity theme override
      EditorView.theme({
        '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, &.cm-focused .cm-content ::selection, .cm-content ::selection': {
          backgroundColor: dark ? '#1e40af !important' : '#bfdbfe !important',
        },
      }),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          const newValue = update.state.doc.toString();
          onChangeRef.current(newValue);
        }
        // Always track selection changes (including when user selects text)
        if (update.selectionSet || update.docChanged) {
          const { from, to } = update.state.selection.main;
          lastSelectionRef.current = { from, to };
        }
      }),
      EditorView.editable.of(!disabled),
    ];

    if (placeholder) {
      extensions.push(cmPlaceholder(placeholder));
    }

    const state = EditorState.create({
      doc: value,
      extensions,
    });

    const view = new EditorView({
      state,
      parent: editorRef.current,
    });

    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Only re-create editor when disabled state or placeholder changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disabled, placeholder]);

  // Sync external value changes into the editor
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    const currentValue = view.state.doc.toString();
    if (currentValue !== value) {
      view.dispatch({
        changes: {
          from: 0,
          to: currentValue.length,
          insert: value,
        },
      });
    }
  }, [value]);

  // Update SQL schema for autocomplete when it changes
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: sqlCompartment.current.reconfigure(sql({ dialect: MySQL, schema: schema || undefined })),
    });
  }, [schema]);

  // Handle the Run Query button click
  const handleRun = useCallback(() => {
    if (!disabled) {
      const view = viewRef.current;
      if (view) {
        const { from, to } = lastSelectionRef.current;
        const selectedText = from !== to ? view.state.sliceDoc(from, to) : '';
        onRun(selectedText);
      } else {
        onRun('');
      }
    }
  }, [disabled, onRun]);

  // Handle keyboard shortcut on the container (fallback for when editor doesn't have focus)
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (!disabled && isRunQueryShortcut(event)) {
        event.preventDefault();
        const view = viewRef.current;
        if (view) {
          const { from, to } = lastSelectionRef.current;
          const selectedText = from !== to ? view.state.sliceDoc(from, to) : '';
          onRun(selectedText);
        } else {
          onRun('');
        }
      }
    },
    [disabled, onRun]
  );

  const shortcutLabel = getRunShortcutLabel();

  return (
    <div
      className="flex flex-col border border-gray-300 dark:border-gray-600 rounded-lg overflow-hidden"
      onKeyDown={handleKeyDown}
      data-testid="sql-editor"
    >
      {/* CodeMirror Editor Container */}
      <div
        ref={editorRef}
        className={`min-h-[120px] max-h-[200px] overflow-auto ${
          disabled ? 'opacity-50 pointer-events-none' : ''
        }`}
        data-testid="sql-editor-codemirror"
      />

      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-2 bg-gray-100 dark:bg-gray-800 border-t border-gray-300 dark:border-gray-600">
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {shortcutLabel} to run • Block/select query yang ingin dijalankan
        </span>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()} // Prevent stealing focus from editor so selection stays
          onClick={handleRun}
          disabled={disabled}
          className="px-4 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50 rounded-md transition-colors"
          data-testid="sql-editor-run-btn"
          aria-label="Run Query"
        >
          Run Query
        </button>
      </div>
    </div>
  );
}
