import path from 'path';
import fs from 'fs/promises';

/**
 * Validate entry name/key
 * @param {string} key - Entry key to validate
 * @returns {Object} { valid: boolean, error?: string }
 */
export function validateEntryKey(key) {
  // Check for empty string
  if (!key || key.trim().length === 0) {
    return { valid: false, error: 'Entry name cannot be empty' };
  }

  // Check length
  if (key.length > 255) {
    return { valid: false, error: 'Entry name too long (max 255 characters)' };
  }

  // Check for problematic characters that might cause issues
  const invalidChars = ['\0', '\n', '\r'];
  for (const char of invalidChars) {
    if (key.includes(char)) {
      return { valid: false, error: 'Entry name contains invalid characters (null, newline)' };
    }
  }

  // Check if it's only whitespace
  if (key.trim() !== key) {
    return { valid: false, error: 'Entry name cannot start or end with whitespace' };
  }

  return { valid: true };
}

/**
 * Validate vault path
 * @param {string} vaultPath - Path to validate
 * @returns {Promise<Object>} { valid: boolean, error?: string }
 */
export async function validateVaultPath(vaultPath) {
  // Check for empty string
  if (!vaultPath || vaultPath.trim().length === 0) {
    return { valid: false, error: 'Vault path cannot be empty' };
  }

  // Check for null bytes
  if (vaultPath.includes('\0')) {
    return { valid: false, error: 'Vault path contains invalid characters' };
  }

  // Must be absolute path
  if (!path.isAbsolute(vaultPath)) {
    return { valid: false, error: 'Vault path must be absolute (not relative)' };
  }

  // Check file extension
  const ext = path.extname(vaultPath);
  if (ext !== '.json') {
    return { valid: false, error: 'Vault file must have .json extension' };
  }

  // Check if parent directory exists
  const parentDir = path.dirname(vaultPath);
  try {
    const stats = await fs.stat(parentDir);
    if (!stats.isDirectory()) {
      return { valid: false, error: 'Parent path is not a directory' };
    }
  } catch (error) {
    if (error.code === 'ENOENT') {
      return { valid: false, error: 'Parent directory does not exist' };
    }
    return { valid: false, error: `Cannot access parent directory: ${error.message}` };
  }

  // Check if parent directory is writable
  try {
    await fs.access(parentDir, fs.constants.W_OK);
  } catch (error) {
    return { valid: false, error: 'Parent directory is not writable' };
  }

  return { valid: true };
}

/**
 * Validate password strength (optional - for user feedback)
 * @param {string} password - Password to validate
 * @returns {Object} { valid: boolean, warning?: string }
 */
export function validatePassword(password) {
  // Minimum requirements
  if (!password || password.length === 0) {
    return { valid: false, error: 'Password cannot be empty' };
  }

  // Weak password warnings (not errors)
  const warnings = [];

  if (password.length < 8) {
    warnings.push('Password is short (< 8 characters)');
  }

  if (password.length < 12) {
    warnings.push('Consider using a longer password (12+ characters recommended)');
  }

  // Check for common patterns
  if (/^[0-9]+$/.test(password)) {
    warnings.push('Password is only numbers');
  }

  if (/^[a-z]+$/.test(password) || /^[A-Z]+$/.test(password)) {
    warnings.push('Password is only letters');
  }

  return {
    valid: true,
    warnings: warnings.length > 0 ? warnings : undefined
  };
}
