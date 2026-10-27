import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('FileEditorModal Component & ServicesModal Integration', () => {
  const editorModalPath = resolve(__dirname, '../../src/components/FileEditorModal.tsx');
  const editorModalContent = readFileSync(editorModalPath, 'utf-8');

  const servicesModalPath = resolve(__dirname, '../../src/components/ServicesModal.tsx');
  const servicesModalContent = readFileSync(servicesModalPath, 'utf-8');

  describe('FileEditorModal Structure & Features', () => {
    it('should be a client component and import required hooks', () => {
      expect(editorModalContent).toContain("'use client'");
      expect(editorModalContent).toContain('useMemo');
      expect(editorModalContent).toContain('useCallback');
      expect(editorModalContent).toContain('useState');
      expect(editorModalContent).toContain('useEffect');
      expect(editorModalContent).toContain('useRef');
    });

    it('should export FileEditorModal default function', () => {
      expect(editorModalContent).toMatch(/export default function FileEditorModal/);
    });

    it('should have required props: vmId, vmLabel, filePath, onClose, onSaved', () => {
      expect(editorModalContent).toContain('interface FileEditorModalProps');
      expect(editorModalContent).toContain('vmId: string');
      expect(editorModalContent).toContain('filePath: string');
      expect(editorModalContent).toContain('onClose: () => void');
      expect(editorModalContent).toContain('onSaved?: () => void');
    });

    it('should maintain content, initialContent, and detect unsaved changes (isDirty)', () => {
      expect(editorModalContent).toContain('const [content, setContent] = useState');
      expect(editorModalContent).toContain('const [initialContent, setInitialContent] = useState');
      expect(editorModalContent).toContain('const isDirty = content !== initialContent');
    });

    it('should display unsaved changes badge when dirty', () => {
      expect(editorModalContent).toContain('Belum disimpan');
      expect(editorModalContent).toContain('isDirty');
    });

    it('should support automatic backup toggle', () => {
      expect(editorModalContent).toContain('createBackup');
      expect(editorModalContent).toContain('setCreateBackup');
      expect(editorModalContent).toContain('Auto-backup');
    });

    it('should support search in file (Ctrl+F)', () => {
      expect(editorModalContent).toContain('searchQuery');
      expect(editorModalContent).toContain('showSearch');
      expect(editorModalContent).toContain('hasil');
    });

    it('should handle keyboard shortcuts for Ctrl+S / Cmd+S save and Escape close with dirty prompt', () => {
      expect(editorModalContent).toContain("(e.ctrlKey || e.metaKey) && e.key === 's'");
      expect(editorModalContent).toContain("(e.ctrlKey || e.metaKey) && e.key === 'f'");
      expect(editorModalContent).toContain('window.confirm');
    });

    it('should support Tab indentation with 2 spaces', () => {
      expect(editorModalContent).toContain("e.key === 'Tab'");
      expect(editorModalContent).toContain("'  '");
    });

    it('should synchronize line numbers scrolling with the textarea', () => {
      expect(editorModalContent).toContain('lineNumbersRef');
      expect(editorModalContent).toContain('handleScroll');
      expect(editorModalContent).toContain('textareaRef');
    });

    it('should display line and column cursor position in status bar', () => {
      expect(editorModalContent).toContain('Ln {cursorPos.line}');
      expect(editorModalContent).toContain('Col {cursorPos.col}');
      expect(editorModalContent).toContain('setCursorPos');
    });
  });

  describe('ServicesModal File Browser & Unit Edit Integration', () => {
    it('should import FileEditorModal', () => {
      expect(servicesModalContent).toContain("import FileEditorModal from './FileEditorModal'");
    });

    it('should maintain selectedEditFilePath state', () => {
      expect(servicesModalContent).toContain('selectedEditFilePath');
      expect(servicesModalContent).toContain('setSelectedEditFilePath');
    });

    it('should define FolderFilesBrowser component', () => {
      expect(servicesModalContent).toContain('function FolderFilesBrowser');
    });

    it('should have Config / Files toggle button next to folder path', () => {
      expect(servicesModalContent).toContain('Config / Files');
      expect(servicesModalContent).toContain('onOpenFile');
    });

    it('should provide Edit button next to systemd unit file', () => {
      expect(servicesModalContent).toContain('Edit Unit');
      expect(servicesModalContent).toContain('service.unitFile');
    });

    it('should render FileEditorModal when selectedEditFilePath is set', () => {
      expect(servicesModalContent).toContain('{selectedEditFilePath && (');
      expect(servicesModalContent).toContain('<FileEditorModal');
      expect(servicesModalContent).toContain('filePath={selectedEditFilePath}');
      expect(servicesModalContent).toContain('onClose={() => setSelectedEditFilePath(null)}');
    });
  });
});
