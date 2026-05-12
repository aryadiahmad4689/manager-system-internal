'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  DEFAULT_PORTS,
  DB_TYPE_LABELS,
  validateConnectionForm,
  getDefaultPort,
} from './connection-form-utils';
import type {
  DatabaseType,
  VMOption,
  ConnectionFormData,
  ConnectionFormInitialData,
  FieldErrors,
} from './connection-form-utils';

export type { DatabaseType, VMOption, ConnectionFormData, ConnectionFormInitialData, FieldErrors };
export { validateConnectionForm, getDefaultPort };

export interface ConnectionFormProps {
  vms?: VMOption[];
  onSubmit: (data: ConnectionFormData) => void | Promise<void>;
  initialData?: ConnectionFormInitialData;
  onCancel?: () => void;
}

export default function ConnectionForm({
  onSubmit,
  initialData,
  onCancel,
}: ConnectionFormProps) {
  const isEditMode = !!initialData;

  const [dbType, setDbType] = useState<DatabaseType>(initialData?.dbType ?? 'mysql');
  const [host, setHost] = useState(initialData?.host ?? 'localhost');
  const [port, setPort] = useState(String(initialData?.port ?? DEFAULT_PORTS['mysql']));
  const [username, setUsername] = useState(initialData?.username ?? '');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Auto-fill port when database type changes (only if user hasn't manually edited port
  // or if the current port matches a known default)
  const handleDbTypeChange = useCallback((newType: DatabaseType) => {
    setDbType(newType);
    const currentPort = parseInt(port, 10);
    // Auto-fill if port is empty, matches any default port, or is NaN
    const isDefaultPort = Object.values(DEFAULT_PORTS).includes(currentPort);
    if (!port || isNaN(currentPort) || isDefaultPort) {
      setPort(String(DEFAULT_PORTS[newType]));
    }
  }, [port]);

  // Set initial port based on initialData or default
  useEffect(() => {
    if (initialData) {
      setDbType(initialData.dbType);
      setHost(initialData.host);
      setPort(String(initialData.port));
      setUsername(initialData.username);
      setPassword('');
      setErrors({});
    }
  }, [initialData]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const validationErrors = validateConnectionForm(
      { dbType, host, port, username, password },
      isEditMode
    );

    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      return;
    }

    setErrors({});
    setIsSubmitting(true);

    const formData: ConnectionFormData = {
      dbType,
      host: host.trim(),
      port: parseInt(port, 10),
      username: username.trim(),
      password,
    };

    const result = onSubmit(formData);
    if (result && typeof result.then === 'function') {
      result
        .then(() => setIsSubmitting(false))
        .catch(() => setIsSubmitting(false));
    } else {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" data-testid="connection-form">
      {/* Database Type */}
      <div>
        <label
          htmlFor="db-type"
          className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
        >
          Database Type
        </label>
        <select
          id="db-type"
          value={dbType}
          onChange={(e) => {
            handleDbTypeChange(e.target.value as DatabaseType);
            if (errors.dbType) setErrors((prev) => ({ ...prev, dbType: undefined }));
          }}
          disabled={isSubmitting}
          className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50"
          aria-invalid={!!errors.dbType}
          aria-describedby={errors.dbType ? 'db-type-error' : undefined}
        >
          {(Object.keys(DB_TYPE_LABELS) as DatabaseType[]).map((type) => (
            <option key={type} value={type}>
              {DB_TYPE_LABELS[type]}
            </option>
          ))}
        </select>
        {errors.dbType && (
          <p id="db-type-error" className="mt-1 text-sm text-red-600 dark:text-red-400" role="alert">
            {errors.dbType}
          </p>
        )}
      </div>

      {/* Host */}
      <div>
        <label
          htmlFor="db-host"
          className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
        >
          Host
        </label>
        <input
          id="db-host"
          type="text"
          value={host}
          onChange={(e) => {
            setHost(e.target.value);
            if (errors.host) setErrors((prev) => ({ ...prev, host: undefined }));
          }}
          disabled={isSubmitting}
          placeholder="localhost"
          className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50"
          aria-invalid={!!errors.host}
          aria-describedby={errors.host ? 'db-host-error' : undefined}
        />
        {errors.host && (
          <p id="db-host-error" className="mt-1 text-sm text-red-600 dark:text-red-400" role="alert">
            {errors.host}
          </p>
        )}
      </div>

      {/* Port */}
      <div>
        <label
          htmlFor="db-port"
          className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
        >
          Port
        </label>
        <input
          id="db-port"
          type="number"
          min="1"
          max="65535"
          value={port}
          onChange={(e) => {
            setPort(e.target.value);
            if (errors.port) setErrors((prev) => ({ ...prev, port: undefined }));
          }}
          disabled={isSubmitting}
          placeholder="3306"
          className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50"
          aria-invalid={!!errors.port}
          aria-describedby={errors.port ? 'db-port-error' : undefined}
        />
        {errors.port && (
          <p id="db-port-error" className="mt-1 text-sm text-red-600 dark:text-red-400" role="alert">
            {errors.port}
          </p>
        )}
      </div>

      {/* Username */}
      <div>
        <label
          htmlFor="db-username"
          className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
        >
          Username
        </label>
        <input
          id="db-username"
          type="text"
          value={username}
          onChange={(e) => {
            setUsername(e.target.value);
            if (errors.username) setErrors((prev) => ({ ...prev, username: undefined }));
          }}
          disabled={isSubmitting}
          placeholder="e.g. root"
          className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50"
          aria-invalid={!!errors.username}
          aria-describedby={errors.username ? 'db-username-error' : undefined}
        />
        {errors.username && (
          <p id="db-username-error" className="mt-1 text-sm text-red-600 dark:text-red-400" role="alert">
            {errors.username}
          </p>
        )}
      </div>

      {/* Password */}
      <div>
        <label
          htmlFor="db-password"
          className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
        >
          Password
          {isEditMode && (
            <span className="text-gray-400 dark:text-gray-500 ml-1">(leave blank to keep current)</span>
          )}
        </label>
        <input
          id="db-password"
          type="password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            if (errors.password) setErrors((prev) => ({ ...prev, password: undefined }));
          }}
          disabled={isSubmitting}
          placeholder={isEditMode ? '••••••••' : 'Enter password'}
          className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50"
          aria-invalid={!!errors.password}
          aria-describedby={errors.password ? 'db-password-error' : undefined}
        />
        {errors.password && (
          <p id="db-password-error" className="mt-1 text-sm text-red-600 dark:text-red-400" role="alert">
            {errors.password}
          </p>
        )}
      </div>

      {/* Actions */}
      <div className="flex gap-3 pt-2">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={isSubmitting}
            className="flex-1 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-md transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
        )}
        <button
          type="submit"
          disabled={isSubmitting}
          className="flex-1 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 disabled:cursor-not-allowed rounded-md transition-colors"
        >
          {isSubmitting
            ? isEditMode
              ? 'Saving...'
              : 'Adding...'
            : isEditMode
              ? 'Save Changes'
              : 'Add Connection'}
        </button>
      </div>
    </form>
  );
}
