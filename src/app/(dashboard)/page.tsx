'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import dynamic from 'next/dynamic';
import type { TerminalTab } from '@/components/TerminalPanel';
import { useVMStatusPolling } from '@/hooks/useVMStatusPolling';

// Dynamically import TerminalPanel to avoid SSR issues with xterm.js
const TerminalPanel = dynamic(() => import('@/components/TerminalPanel'), {
  ssr: false,
});

// Dynamically import LogViewer to avoid SSR issues with Socket.IO
const LogViewer = dynamic(() => import('@/components/LogViewer'), {
  ssr: false,
});

interface VM {
  id: string;
  label: string;
  host: string;
  port: number;
  username: string;
  createdAt: string;
  updatedAt: string;
}

interface VMWithStatus extends VM {
  status: 'online' | 'offline' | 'unreachable';
}

interface AddVMFormData {
  label: string;
  host: string;
  port: string;
  username: string;
  password: string;
}

const initialFormData: AddVMFormData = {
  label: '',
  host: '',
  port: '22',
  username: '',
  password: '',
};

function StatusIndicator({ status }: { status: 'online' | 'offline' | 'unreachable' }) {
  const colorMap = {
    online: 'bg-green-500',
    offline: 'bg-red-500',
    unreachable: 'bg-yellow-500',
  };

  const labelMap = {
    online: 'Online',
    offline: 'Offline',
    unreachable: 'Unreachable',
  };

  return (
    <span className="flex items-center gap-2">
      <span
        className={`inline-block w-3 h-3 rounded-full ${colorMap[status]}`}
        aria-label={`Status: ${labelMap[status]}`}
      />
      <span className="text-sm text-gray-500 dark:text-gray-400">{labelMap[status]}</span>
    </span>
  );
}

function VMCard({ vm, onConnect, onEdit, onDelete }: { vm: VMWithStatus; onConnect: (vm: VMWithStatus) => void; onEdit: (vm: VMWithStatus) => void; onDelete: (vm: VMWithStatus) => void }) {
  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4 hover:border-gray-300 dark:hover:border-gray-600 transition-colors">
      <div className="flex items-start justify-between mb-3">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 truncate">{vm.label}</h3>
        <StatusIndicator status={vm.status} />
      </div>

      <div className="space-y-1 text-sm text-gray-500 dark:text-gray-400">
        <p>
          <span className="text-gray-400 dark:text-gray-500">Host:</span>{' '}
          <span className="text-gray-700 dark:text-gray-300 font-mono">{vm.host}</span>
        </p>
        <p>
          <span className="text-gray-400 dark:text-gray-500">Port:</span>{' '}
          <span className="text-gray-700 dark:text-gray-300 font-mono">{vm.port}</span>
        </p>
        <p>
          <span className="text-gray-400 dark:text-gray-500">User:</span>{' '}
          <span className="text-gray-700 dark:text-gray-300">{vm.username}</span>
        </p>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          onClick={() => onConnect(vm)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-green-600 hover:bg-green-700 rounded-md transition-colors"
          aria-label={`Connect to ${vm.label}`}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          Connect
        </button>
        <button
          onClick={() => onEdit(vm)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-200 bg-gray-200 dark:bg-gray-600 hover:bg-gray-300 dark:hover:bg-gray-500 rounded-md transition-colors"
          aria-label={`Edit ${vm.label}`}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
          </svg>
          Edit
        </button>
        <button
          onClick={() => onDelete(vm)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-red-600 dark:text-red-300 bg-red-100 dark:bg-red-900/50 hover:bg-red-200 dark:hover:bg-red-800 rounded-md transition-colors"
          aria-label={`Delete ${vm.label}`}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
          Delete
        </button>
      </div>
    </div>
  );
}

function AddVMModal({
  isOpen,
  onClose,
  onSubmit,
  isSubmitting,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: AddVMFormData) => void;
  isSubmitting: boolean;
}) {
  const [formData, setFormData] = useState<AddVMFormData>(initialFormData);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isOpen) {
      setFormData(initialFormData);
      setError('');
    }
  }, [isOpen]);

  if (!isOpen) return null;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (!formData.label.trim()) {
      setError('Label is required');
      return;
    }
    if (!formData.host.trim()) {
      setError('Host is required');
      return;
    }
    if (!formData.username.trim()) {
      setError('Username is required');
      return;
    }
    if (!formData.password.trim()) {
      setError('Password is required');
      return;
    }

    const port = parseInt(formData.port, 10);
    if (isNaN(port) || port < 1 || port > 65535) {
      setError('Port must be between 1 and 65535');
      return;
    }

    onSubmit(formData);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 md:p-4">
      <div
        className="fixed inset-0 bg-black/60"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="relative w-full max-w-md bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl p-4 md:p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Add New VM</h2>
          <button
            onClick={onClose}
            className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
            aria-label="Close modal"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="vm-label" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Label
            </label>
            <input
              id="vm-label"
              type="text"
              value={formData.label}
              onChange={(e) => setFormData({ ...formData, label: e.target.value })}
              className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="e.g. Production Server"
              disabled={isSubmitting}
            />
          </div>

          <div>
            <label htmlFor="vm-host" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Host
            </label>
            <input
              id="vm-host"
              type="text"
              value={formData.host}
              onChange={(e) => setFormData({ ...formData, host: e.target.value })}
              className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="e.g. 192.168.1.100"
              disabled={isSubmitting}
            />
          </div>

          <div>
            <label htmlFor="vm-port" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Port
            </label>
            <input
              id="vm-port"
              type="number"
              min="1"
              max="65535"
              value={formData.port}
              onChange={(e) => setFormData({ ...formData, port: e.target.value })}
              className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="22"
              disabled={isSubmitting}
            />
          </div>

          <div>
            <label htmlFor="vm-username" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Username
            </label>
            <input
              id="vm-username"
              type="text"
              value={formData.username}
              onChange={(e) => setFormData({ ...formData, username: e.target.value })}
              className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="e.g. root"
              disabled={isSubmitting}
            />
          </div>

          <div>
            <label htmlFor="vm-password" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Password
            </label>
            <input
              id="vm-password"
              type="password"
              value={formData.password}
              onChange={(e) => setFormData({ ...formData, password: e.target.value })}
              className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Enter password"
              disabled={isSubmitting}
            />
          </div>

          {error && (
            <div role="alert" className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-md px-3 py-2">
              {error}
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="flex-1 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-md transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex-1 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 disabled:cursor-not-allowed rounded-md transition-colors"
            >
              {isSubmitting ? 'Adding...' : 'Add VM'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function EditVMModal({
  vm,
  onClose,
  onSubmit,
}: {
  vm: VMWithStatus;
  onClose: () => void;
  onSubmit: (data: { label: string; host: string; port: number; username: string; password: string }) => void;
}) {
  const [label, setLabel] = useState(vm.label);
  const [host, setHost] = useState(vm.host);
  const [port, setPort] = useState(String(vm.port));
  const [username, setUsername] = useState(vm.username);
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await onSubmit({
        label: label.trim(),
        host: host.trim(),
        port: parseInt(port, 10) || 22,
        username: username.trim(),
        password: password,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/60" onClick={onClose} aria-hidden="true" />
      <div className="relative w-full max-w-md bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Edit VM</h2>
          <button onClick={onClose} className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200" aria-label="Close">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Label</label>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Host</label>
            <input
              type="text"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Port</label>
            <input
              type="number"
              min="1"
              max="65535"
              value={port}
              onChange={(e) => setPort(e.target.value)}
              className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Username</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Password <span className="text-gray-400 dark:text-gray-500">(kosongkan jika tidak ingin ganti)</span>
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-md transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 rounded-md transition-colors"
            >
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const [vms, setVms] = useState<VMWithStatus[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [terminalTabs, setTerminalTabs] = useState<TerminalTab[]>([]);
  const [activeTerminalTabId, setActiveTerminalTabId] = useState<string | null>(null);
  const [logViewerVm, setLogViewerVm] = useState<VMWithStatus | null>(null);
  const [editVm, setEditVm] = useState<VMWithStatus | null>(null);
  const [deleteVm, setDeleteVm] = useState<VMWithStatus | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const fetchVMs = useCallback(async () => {
    try {
      const res = await fetch('/api/vms');
      if (!res.ok) {
        throw new Error('Failed to fetch VMs');
      }
      const data: VM[] = await res.json();

      // Fetch status for each VM
      const vmsWithStatus: VMWithStatus[] = await Promise.all(
        data.map(async (vm) => {
          try {
            const statusRes = await fetch(`/api/vms/${vm.id}/status`);
            if (statusRes.ok) {
              const statusData = await statusRes.json();
              return { ...vm, status: statusData.status };
            }
          } catch {
            // Ignore status fetch errors
          }
          return { ...vm, status: 'offline' as const };
        })
      );

      setVms(vmsWithStatus);
      setError('');
    } catch {
      setError('Failed to load VM list');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchVMs();
  }, [fetchVMs]);

  // Extract VM IDs for status polling
  const vmIds = useMemo(() => vms.map((vm) => vm.id), [vms]);

  // Real-time status polling via API (60s interval) and Socket.IO events
  const { statusMap } = useVMStatusPolling({
    vmIds,
    enabled: vmIds.length > 0,
  });

  // Merge real-time status updates with the VM list
  const vmsWithLiveStatus = useMemo<VMWithStatus[]>(() => {
    if (statusMap.size === 0) return vms;
    return vms.map((vm) => {
      const liveStatus = statusMap.get(vm.id);
      if (liveStatus) {
        return { ...vm, status: liveStatus.status };
      }
      return vm;
    });
  }, [vms, statusMap]);

  const handleConnect = useCallback((vm: VMWithStatus) => {
    // Check if a tab for this VM already exists
    const existingTab = terminalTabs.find(tab => tab.vmId === vm.id);
    if (existingTab) {
      // Tab already exists, activate it
      setActiveTerminalTabId(existingTab.id);
      return;
    }

    // Create a new terminal tab
    const newTab: TerminalTab = {
      id: `${vm.id}-${Date.now()}`,
      vmId: vm.id,
      vmLabel: vm.label,
    };

    setTerminalTabs(prev => [...prev, newTab]);
    setActiveTerminalTabId(newTab.id);
  }, [terminalTabs]);

  const handleCloseTab = useCallback((tabId: string) => {
    setTerminalTabs(prev => {
      const remaining = prev.filter(tab => tab.id !== tabId);
      // If closing the active tab, switch to another
      if (activeTerminalTabId === tabId) {
        const idx = prev.findIndex(t => t.id === tabId);
        if (remaining.length > 0) {
          setActiveTerminalTabId(remaining[Math.min(idx, remaining.length - 1)].id);
        } else {
          setActiveTerminalTabId(null);
        }
      }
      return remaining;
    });
  }, [activeTerminalTabId]);

  const handleViewLogs = useCallback((vm: VMWithStatus) => {
    setLogViewerVm(vm);
  }, []);

  const handleCloseLogViewer = useCallback(() => {
    setLogViewerVm(null);
  }, []);

  const handleEdit = useCallback((vm: VMWithStatus) => {
    setEditVm(vm);
  }, []);

  const handleDelete = useCallback((vm: VMWithStatus) => {
    setDeleteVm(vm);
  }, []);

  const handleConfirmDelete = useCallback(async () => {
    if (!deleteVm) return;
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/vms/${deleteVm.id}`, { method: 'DELETE' });
      if (res.ok) {
        setDeleteVm(null);
        // Remove terminal tabs for this VM
        setTerminalTabs(prev => prev.filter(tab => tab.vmId !== deleteVm.id));
        await fetchVMs();
      }
    } catch {
      // ignore
    } finally {
      setIsDeleting(false);
    }
  }, [deleteVm, fetchVMs]);

  const handleEditSubmit = useCallback(async (data: { label: string; host: string; port: number; username: string; password: string }) => {
    if (!editVm) return;
    const body: any = {};
    if (data.label !== editVm.label) body.label = data.label;
    if (data.host !== editVm.host) body.host = data.host;
    if (data.port !== editVm.port) body.port = data.port;
    if (data.username !== editVm.username) body.username = data.username;
    if (data.password) body.password = data.password;

    if (Object.keys(body).length === 0) {
      setEditVm(null);
      return;
    }

    const res = await fetch(`/api/vms/${editVm.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (res.ok) {
      setEditVm(null);
      await fetchVMs();
    }
  }, [editVm, fetchVMs]);

  async function handleAddVM(formData: AddVMFormData) {
    setIsSubmitting(true);
    try {
      const res = await fetch('/api/vms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: formData.label.trim(),
          host: formData.host.trim(),
          port: parseInt(formData.port, 10),
          username: formData.username.trim(),
          password: formData.password,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to add VM');
      }

      setIsModalOpen(false);
      await fetchVMs();
    } catch (err) {
      // Re-throw to let the modal handle the error display
      throw err;
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* VM list section */}
      <div className={`${terminalTabs.length > 0 ? 'flex-shrink-0' : 'flex-1'}`}>
        {/* Page header */}
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Virtual Machines</h1>
          <button
            onClick={() => setIsModalOpen(true)}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add VM
          </button>
        </div>

        {/* Error state */}
        {error && (
          <div role="alert" className="mb-4 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-md px-4 py-3">
            {error}
          </div>
        )}

        {/* Loading state */}
        {isLoading && (
          <div className="flex items-center justify-center py-12">
            <div className="text-gray-500 dark:text-gray-400">Loading VMs...</div>
          </div>
        )}

        {/* Empty state */}
        {!isLoading && !error && vms.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <svg className="w-16 h-16 text-gray-400 dark:text-gray-600 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2" />
            </svg>
            <p className="text-gray-500 dark:text-gray-400 mb-2">No VMs configured yet</p>
            <p className="text-sm text-gray-400 dark:text-gray-500">Click &quot;Add VM&quot; to get started</p>
          </div>
        )}

        {/* VM grid */}
        {!isLoading && vms.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3 gap-4">
            {vmsWithLiveStatus.map((vm) => (
              <VMCard key={vm.id} vm={vm} onConnect={handleConnect} onEdit={handleEdit} onDelete={handleDelete} />
            ))}
          </div>
        )}
      </div>

      {/* Terminal panel */}
      {terminalTabs.length > 0 && (
        <div className="flex-1 min-h-[250px] md:min-h-[300px] mt-4 flex flex-col">
          {/* VM Terminal Tabs - always visible */}
          <div className="flex items-center bg-gray-800 border border-gray-700 rounded-t-lg overflow-x-auto flex-shrink-0">
            {terminalTabs.map((tab) => (
              <div
                key={tab.id}
                onClick={() => setActiveTerminalTabId(tab.id)}
                className={`flex items-center gap-2 px-3 py-1.5 text-xs cursor-pointer border-r border-gray-700 min-w-0 transition-colors ${
                  activeTerminalTabId === tab.id
                    ? 'bg-gray-900 text-white border-b-2 border-b-green-500'
                    : 'text-gray-400 hover:text-white hover:bg-gray-700'
                }`}
                title={tab.vmLabel}
              >
                <svg className="w-3.5 h-3.5 flex-shrink-0 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <span className="truncate max-w-[100px]">{tab.vmLabel}</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleCloseTab(tab.id);
                  }}
                  className="ml-1 text-gray-500 hover:text-red-400 flex-shrink-0"
                  aria-label={`Close terminal for ${tab.vmLabel}`}
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
          {/* Terminal content */}
          <div className="flex-1 min-h-0">
            <TerminalPanel
              tabs={terminalTabs}
              activeTabId={activeTerminalTabId}
              onCloseTab={handleCloseTab}
            />
          </div>
        </div>
      )}

      {/* Log viewer panel */}
      {logViewerVm && (
        <div className="fixed inset-0 z-40 flex items-center justify-center p-2 md:p-4">
          <div
            className="fixed inset-0 bg-black/60"
            onClick={handleCloseLogViewer}
            aria-hidden="true"
          />
          <div className="relative w-full max-w-full md:max-w-3xl lg:max-w-4xl h-[85vh] md:h-[80vh] z-50">
            <LogViewer
              vmId={logViewerVm.id}
              vmLabel={logViewerVm.label}
              onClose={handleCloseLogViewer}
            />
          </div>
        </div>
      )}

      {/* Add VM Modal */}
      <AddVMModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSubmit={handleAddVM}
        isSubmitting={isSubmitting}
      />

      {/* Edit VM Modal */}
      {editVm && (
        <EditVMModal
          vm={editVm}
          onClose={() => setEditVm(null)}
          onSubmit={handleEditSubmit}
        />
      )}

      {/* Delete Confirmation */}
      {deleteVm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/60" onClick={() => setDeleteVm(null)} aria-hidden="true" />
          <div className="relative w-full max-w-sm bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl p-6">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">Delete VM</h2>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
              Yakin ingin menghapus <span className="text-gray-900 dark:text-white font-medium">{deleteVm.label}</span>? Aksi ini tidak bisa di-undo.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setDeleteVm(null)}
                disabled={isDeleting}
                className="flex-1 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-md transition-colors"
              >
                Batal
              </button>
              <button
                onClick={handleConfirmDelete}
                disabled={isDeleting}
                className="flex-1 px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 disabled:bg-red-800 rounded-md transition-colors"
              >
                {isDeleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
