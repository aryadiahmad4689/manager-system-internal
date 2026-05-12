import { describe, it, expect } from 'vitest';
import {
  validateConnectionForm,
  getDefaultPort,
} from '@/components/db/connection-form-utils';
import type { DatabaseType, FieldErrors } from '@/components/db/connection-form-utils';

describe('ConnectionForm - getDefaultPort', () => {
  it('should return 3306 for mysql', () => {
    expect(getDefaultPort('mysql')).toBe(3306);
  });

  it('should return 5432 for postgresql', () => {
    expect(getDefaultPort('postgresql')).toBe(5432);
  });

  it('should return 3306 for mariadb', () => {
    expect(getDefaultPort('mariadb')).toBe(3306);
  });
});

describe('ConnectionForm - validateConnectionForm', () => {
  const validData = {
    dbType: 'mysql',
    host: 'localhost',
    port: '3306',
    username: 'root',
    password: 'secret',
  };

  describe('create mode (isEditMode = false)', () => {
    it('should return no errors for valid data', () => {
      const errors = validateConnectionForm(validData, false);
      expect(Object.keys(errors)).toHaveLength(0);
    });

    it('should return error when dbType is empty', () => {
      const errors = validateConnectionForm({ ...validData, dbType: '' }, false);
      expect(errors.dbType).toBe('Database type is required');
    });

    it('should return error when host is empty', () => {
      const errors = validateConnectionForm({ ...validData, host: '' }, false);
      expect(errors.host).toBe('Host is required');
    });

    it('should return error when host is only whitespace', () => {
      const errors = validateConnectionForm({ ...validData, host: '   ' }, false);
      expect(errors.host).toBe('Host is required');
    });

    it('should return error when port is empty', () => {
      const errors = validateConnectionForm({ ...validData, port: '' }, false);
      expect(errors.port).toBe('Port is required');
    });

    it('should return error when port is not a number', () => {
      const errors = validateConnectionForm({ ...validData, port: 'abc' }, false);
      expect(errors.port).toBe('Port must be a number');
    });

    it('should return error when port is below 1', () => {
      const errors = validateConnectionForm({ ...validData, port: '0' }, false);
      expect(errors.port).toBe('Port must be between 1 and 65535');
    });

    it('should return error when port is above 65535', () => {
      const errors = validateConnectionForm({ ...validData, port: '65536' }, false);
      expect(errors.port).toBe('Port must be between 1 and 65535');
    });

    it('should return error when port is negative', () => {
      const errors = validateConnectionForm({ ...validData, port: '-1' }, false);
      expect(errors.port).toBe('Port must be between 1 and 65535');
    });

    it('should accept port at boundary value 1', () => {
      const errors = validateConnectionForm({ ...validData, port: '1' }, false);
      expect(errors.port).toBeUndefined();
    });

    it('should accept port at boundary value 65535', () => {
      const errors = validateConnectionForm({ ...validData, port: '65535' }, false);
      expect(errors.port).toBeUndefined();
    });

    it('should return error when username is empty', () => {
      const errors = validateConnectionForm({ ...validData, username: '' }, false);
      expect(errors.username).toBe('Username is required');
    });

    it('should return error when username is only whitespace', () => {
      const errors = validateConnectionForm({ ...validData, username: '   ' }, false);
      expect(errors.username).toBe('Username is required');
    });

    it('should return error when password is empty in create mode', () => {
      const errors = validateConnectionForm({ ...validData, password: '' }, false);
      expect(errors.password).toBe('Password is required');
    });

    it('should return multiple errors when multiple fields are invalid', () => {
      const errors = validateConnectionForm(
        { dbType: '', host: '', port: '', username: '', password: '' },
        false
      );
      expect(errors.dbType).toBeDefined();
      expect(errors.host).toBeDefined();
      expect(errors.port).toBeDefined();
      expect(errors.username).toBeDefined();
      expect(errors.password).toBeDefined();
    });
  });

  describe('edit mode (isEditMode = true)', () => {
    it('should not require password in edit mode', () => {
      const errors = validateConnectionForm({ ...validData, password: '' }, true);
      expect(errors.password).toBeUndefined();
    });

    it('should still validate other fields in edit mode', () => {
      const errors = validateConnectionForm(
        { dbType: 'mysql', host: '', port: '3306', username: 'root', password: '' },
        true
      );
      expect(errors.host).toBe('Host is required');
      expect(errors.password).toBeUndefined();
    });

    it('should accept valid data with empty password in edit mode', () => {
      const errors = validateConnectionForm(
        { dbType: 'mysql', host: 'localhost', port: '3306', username: 'root', password: '' },
        true
      );
      expect(Object.keys(errors)).toHaveLength(0);
    });
  });
});

describe('ConnectionForm - port auto-fill logic', () => {
  it('should map mysql to port 3306', () => {
    expect(getDefaultPort('mysql')).toBe(3306);
  });

  it('should map postgresql to port 5432', () => {
    expect(getDefaultPort('postgresql')).toBe(5432);
  });

  it('should map mariadb to port 3306', () => {
    expect(getDefaultPort('mariadb')).toBe(3306);
  });

  it('should provide different port for postgresql vs mysql', () => {
    expect(getDefaultPort('postgresql')).not.toBe(getDefaultPort('mysql'));
  });
});
