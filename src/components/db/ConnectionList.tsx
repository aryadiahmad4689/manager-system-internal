'use client';

import { useState } from 'react';
import {
  getStatusIndicator,
  getAvailableActions,
  formatDbType,
} from './connection-list-utils';
import type { ConnectionItem } from './connection-list-utils';

export type { ConnectionItem };

export interface ConnectionListProps {
  connections: ConnectionItem[];
  onConnect: (id: string) => void;
  onDisconnect: (id: string) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
}

export default function ConnectionList({
  connections,
  onConnect,
  onDisconnect,
  onEdit,
  onDelete,
}: ConnectionListProps) {
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  function handleDeleteClick(id: string) {
    setDeleteConfirmId(id);
  }

  function handleConfirmDelete() {
    if (deleteConfirmId) {
      onDelete(deleteConfirmId);
      setDeleteConfirmId(null);
    }
  }

  function handleCancelDelete() {
    setDeleteConfirmId(null);
  }

  if (connections.length === 0) {
    return (
      <div
        data-testid="connection-list-empty"
        className="text-center py-8 text-gray-500 dark:text-gray-400"
      >
        <svg
          className="mx-auto h-12 w-12 text-gray-400 dark:text-gray-500 mb-3"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"
          />
        </svg>
        <p className="text-sm font-medium">No database connections</p>
        <p className="text-xs mt-1">Add a connection to get started.</p>
      </div>
    );
  }

  return (
    <div data-testid="connection-list" className="space-y-2">
      {connections.map((connection) => {
        const indicator = getStatusIndicator(connection.status);
        const actions = getAvailableActions(connection.status);

        return (
          <div
            key={connection.id}
            data-testid={`connection-item-${connection.id}`}
            className="p-3 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg"
          >
            {/* Connection info */}
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2 min-w-0">
                <span
                  data-testid={`status-dot-${connection.id}`}
                  className={`inline-block w-2.5 h-2.5 rounded-full flex-shrink-0 ${indicator.dotClass}`}
                  title={indicator.label}
                  aria-label={`Status: ${indicator.label}`}
                />
                <span className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                  {connection.label || `${connection.host}:${connection.port}`}
                </span>
                <span className="text-xs px-1.5 py-0.5 bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 rounded flex-shrink-0">
                  {formatDbType(connection.dbType)}
                </span>
              </div>
              <span className="text-xs text-gray-500 dark:text-gray-400 flex-shrink-0 ml-2">
                {indicator.label}
              </span>
            </div>

            {/* Connection details */}
            <div className="text-xs text-gray-600 dark:text-gray-400 mb-2">
              <span>{connection.username}@{connection.host}:{connection.port}</span>
            </div>

            {/* Actions */}
            <div className="flex gap-2">
              {actions.canConnect && (
                <button
                  type="button"
                  onClick={() => onConnect(connection.id)}
                  data-testid={`connect-btn-${connection.id}`}
                  className="px-2 py-1 text-xs font-medium text-green-700 dark:text-green-300 bg-green-50 dark:bg-green-900/30 hover:bg-green-100 dark:hover:bg-green-900/50 border border-green-200 dark:border-green-700 rounded transition-colors"
                >
                  Connect
                </button>
              )}
              {actions.canDisconnect && (
                <button
                  type="button"
                  onClick={() => onDisconnect(connection.id)}
                  data-testid={`disconnect-btn-${connection.id}`}
                  className="px-2 py-1 text-xs font-medium text-orange-700 dark:text-orange-300 bg-orange-50 dark:bg-orange-900/30 hover:bg-orange-100 dark:hover:bg-orange-900/50 border border-orange-200 dark:border-orange-700 rounded transition-colors"
                >
                  Disconnect
                </button>
              )}
              <button
                type="button"
                onClick={() => onEdit(connection.id)}
                data-testid={`edit-btn-${connection.id}`}
                className="px-2 py-1 text-xs font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-600 hover:bg-gray-200 dark:hover:bg-gray-500 border border-gray-300 dark:border-gray-500 rounded transition-colors"
              >
                Edit
              </button>
              <button
                type="button"
                onClick={() => handleDeleteClick(connection.id)}
                data-testid={`delete-btn-${connection.id}`}
                className="px-2 py-1 text-xs font-medium text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/30 hover:bg-red-100 dark:hover:bg-red-900/50 border border-red-200 dark:border-red-700 rounded transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        );
      })}

      {/* Delete Confirmation Dialog */}
      {deleteConfirmId && (
        <div
          data-testid="delete-confirm-dialog"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-dialog-title"
        >
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 max-w-sm mx-4 w-full">
            <h3
              id="delete-dialog-title"
              className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2"
            >
              Delete Connection
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
              Are you sure you want to delete this connection? This will remove the connection
              configuration, stored credentials, and all associated query history. This action
              cannot be undone.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                type="button"
                onClick={handleCancelDelete}
                data-testid="delete-cancel-btn"
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-md transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                data-testid="delete-confirm-btn"
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-md transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
