import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import os from 'os';
import lockfile from 'proper-lockfile';
import chalk from 'chalk';
import { encryptJson, decryptJson, secureWipe } from './crypto.js';
import { passwordRateLimiter } from './ratelimit.js';

// Track active locks for cleanup on exit
const activeLocks = new Set();

/**
 * Audit logging system
 */
class AuditLogger {
  constructor() {
    this.auditFile = path.join(os.homedir(), '.pwcli-audit.json');
    this.maxEntries = 1000; // Keep last 1000 entries
  }

  /**
   * Log an audit event
   * @param {string} action - Action performed
   * @param {string} details - Additional details
   * @param {string} result - Success/Failure
   */
  async log(action, details = '', result = 'success') {
    try {
      let existingLogs = [];
      
      try {
        const data = await fs.readFile(this.auditFile, 'utf8');
        existingLogs = JSON.parse(data);
      } catch (error) {
        if (error.code !== 'ENOENT') {
          console.warn('Could not read audit file:', error.message);
          return;
        }
      }

      const logEntry = {
        timestamp: new Date().toISOString(),
        action: action,
        details: details,
        result: result,
        pid: process.pid
      };

      existingLogs.push(logEntry);

      // Keep only the most recent entries
      if (existingLogs.length > this.maxEntries) {
        existingLogs = existingLogs.slice(-this.maxEntries);
      }

      await fs.writeFile(this.auditFile, JSON.stringify(existingLogs, null, 2), {
        mode: 0o600,
        encoding: 'utf8'
      });
    } catch (error) {
      console.warn('Could not write audit log:', error.message);
    }
  }

  /**
   * Get recent audit logs
   * @param {number} limit - Number of entries to retrieve
   * @returns {Promise<Array>} Recent log entries
   */
  async getRecentLogs(limit = 50) {
    try {
      const data = await fs.readFile(this.auditFile, 'utf8');
      const logs = JSON.parse(data);
      return logs.slice(-limit);
    } catch (error) {
      if (error.code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  /**
   * Clear audit logs
   */
  async clearLogs() {
    try {
      await fs.unlink(this.auditFile);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
  }
}

// Global audit logger instance
export const auditLogger = new AuditLogger();

/**
 * Add lock to cleanup tracking
 */
function trackLock(vaultPath, release) {
  activeLocks.add({ vaultPath, release });
}

/**
 * Remove lock from tracking
 */
function untrackLock(vaultPath, release) {
  activeLocks.forEach(lock => {
    if (lock.release === release) {
      activeLocks.delete(lock);
    }
  });
}

// Set up process exit handlers for cleanup
if (typeof process !== 'undefined') {
  const cleanupLocks = () => {
    activeLocks.forEach(lock => {
      if (lock.release) {
        try {
          lock.release();
        } catch (error) {
          // Ignore errors during cleanup
        }
      }
    });
  };

  process.on('exit', cleanupLocks);

  process.on('SIGINT', () => {
    cleanupLocks();
    process.exit(1);
  });

  process.on('SIGTERM', () => {
    cleanupLocks();
    process.exit(1);
  });
}

/**
 * Check if vault file exists
 * @param {string} vaultPath - Path to vault file
 * @returns {Promise<boolean>} True if exists
 */
export async function vaultExists(vaultPath) {
  try {
    await fs.access(vaultPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Create a new encrypted vault
 * @param {string} vaultPath - Path to vault file
 * @param {string} password - Master password
 * @returns {Promise<void>}
 */
export async function createVault(vaultPath, password) {
  const now = new Date().toISOString();
  const emptyVault = {
    entries: {},
    createdAt: now,
    updatedAt: now
  };

  const encrypted = await encryptJson(emptyVault, password);
  await fs.writeFile(vaultPath, JSON.stringify(encrypted, null, 2), {
    mode: 0o600,
    encoding: 'utf8'
  });
  
  // Log vault creation
  await auditLogger.log('vault_create', `Created vault at ${vaultPath}`, 'success');
}

/**
 * Load and decrypt vault
 * @param {string} vaultPath - Path to vault file
 * @param {string} password - Master password
 * @returns {Promise<Object>} Decrypted vault { entries, createdAt, updatedAt }
 * @throws {Error} If vault doesn't exist or decryption fails
 */
export async function loadVault(vaultPath, password) {
  // Rate limit password attempts (1 per second)
  await passwordRateLimiter.waitIfNeeded();

  const exists = await vaultExists(vaultPath);
  if (!exists) {
    throw new Error('Vault file does not exist');
  }

  const encrypted = JSON.parse(await fs.readFile(vaultPath, 'utf8'));

  try {
    const decrypted = await decryptJson(encrypted, password);
    // Reset rate limiter on successful decryption
    await passwordRateLimiter.reset();
    // Log successful access
    await auditLogger.log('vault_access', `Successfully accessed ${vaultPath}`, 'success');
    return decrypted;
  } catch (error) {
    // Record failed attempt for persistent rate limiting
    await passwordRateLimiter.recordFailure();
    // Log failed access attempt
    await auditLogger.log('vault_access', `Failed to access ${vaultPath}`, 'failure');
    throw error;
  }
}

/**
 * Save and encrypt vault
 * @param {string} vaultPath - Path to vault file
 * @param {string} password - Master password
 * @param {Object} vault - Vault data { entries, createdAt, updatedAt }
 * @returns {Promise<void>}
 */
export async function saveVault(vaultPath, password, vault) {
  // Update timestamp
  vault.updatedAt = new Date().toISOString();

  // Acquire lock
  let release;
  try {
    release = await lockfile.lock(vaultPath, {
      retries: { retries: 5, minTimeout: 100 },
      stale: 5000 // Reduced from 10000 to 5000ms for faster cleanup
    });
    // Track this lock for cleanup
    trackLock(vaultPath, release);
  } catch (error) {
    // File might not exist yet (first save)
    if (error.code !== 'ENOENT') {
      throw new Error('Failed to acquire lock on vault file');
    }
  }

  try {
    const encrypted = await encryptJson(vault, password);
    await fs.writeFile(vaultPath, JSON.stringify(encrypted, null, 2), {
      mode: 0o600,
      encoding: 'utf8'
    });
  } finally {
    if (release) {
      // Untrack before releasing
      untrackLock(vaultPath, release);
      await release();
    }
  }
}

/**
 * Get list of all keys in vault
 * @param {Object} entries - Vault entries
 * @returns {string[]} Array of keys
 */
export function listKeys(entries) {
  return Object.keys(entries).sort();
}

/**
 * Change master password (re-encrypt vault with new password)
 * @param {string} vaultPath - Path to vault file
 * @param {string} oldPassword - Current master password
 * @param {string} newPassword - New master password
 * @returns {Promise<void>}
 * @throws {Error} If old password is incorrect
 */
export async function changeMasterPassword(vaultPath, oldPassword, newPassword) {
  // Create backup before password change
  const backupPath = vaultPath + '.backup';
  
  try {
    // Decrypt with old password
    const vault = await loadVault(vaultPath, oldPassword);
    
    // Clone vault to avoid modifying the original in case of failure
    const vaultClone = JSON.parse(JSON.stringify(vault));

    // Re-encrypt with new password (generates new salt and IV)
    await saveVault(vaultPath, newPassword, vaultClone);
    
    // Remove backup on success
    try {
      await fs.unlink(backupPath);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.warn('Warning: Could not remove backup file:', error.message);
      }
    }
  } catch (error) {
    // If password change failed, try to remove backup if it exists
    try {
      await fs.unlink(backupPath);
    } catch (backupError) {
      // Ignore if backup doesn't exist
    }
    throw error;
  }
}

/**
 * Move vault to new location
 * @param {string} oldPath - Current vault path
 * @param {string} newPath - New vault path
 * @param {string} password - Master password (for verification)
 * @returns {Promise<void>}
 */
export async function moveVault(oldPath, newPath, password) {
  // Verify password by attempting to decrypt
  await loadVault(oldPath, password);

  // Verify destination directory exists and is writable
  try {
    const newDir = path.dirname(newPath);
    await fs.access(newDir, fs.constants.W_OK);
  } catch (error) {
    throw new Error(`Destination directory is not writable: ${error.message}`);
  }

  // Check if destination file already exists
  try {
    await fs.access(newPath);
    throw new Error('Destination file already exists');
  } catch (error) {
    // Expected - destination should not exist
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }

  // Copy to new location
  await fs.copyFile(oldPath, newPath);
  
  // Set proper permissions on the new vault file
  await fs.chmod(newPath, 0o600);

  // Verify new file works by decrypting it
  try {
    await loadVault(newPath, password);

    // Verify file sizes match
    const oldStats = await fs.stat(oldPath);
    const newStats = await fs.stat(newPath);
    if (oldStats.size !== newStats.size) {
      throw new Error('File size mismatch after copy');
    }

    // Delete old file only after successful verification
    await fs.unlink(oldPath);
  } catch (error) {
    // Rollback - delete new file and preserve old file
    try {
      await fs.unlink(newPath);
    } catch (unlinkError) {
      // If we can't delete the new file, warn but don't fail
      console.error('Warning: Failed to delete incomplete vault at new location');
    }
    throw new Error(`Failed to move vault - rolled back: ${error.message}`);
  }
}

/**
 * Securely wipe and delete vault file
 * @param {string} vaultPath - Path to vault file
 * @returns {Promise<void>}
 */
export async function nukeVault(vaultPath) {
  try {
    // Get file size
    const stats = await fs.stat(vaultPath);
    const size = stats.size;

    // Overwrite with random data
    const randomData = crypto.randomBytes(size);
    await fs.writeFile(vaultPath, randomData);
    secureWipe(randomData);

    // Overwrite with zeros
    const zeroBuffer = Buffer.alloc(size, 0);
    await fs.writeFile(vaultPath, zeroBuffer);
    secureWipe(zeroBuffer);

    // Delete file
    await fs.unlink(vaultPath);
  } catch (error) {
    throw new Error(`Failed to nuke vault: ${error.message}`);
  }
}

/**
 * Export vault to unencrypted JSON file (use with caution!)
 * @param {string} vaultPath - Path to vault file
 * @param {string} password - Master password
 * @param {string} exportPath - Path for export file
 * @returns {Promise<void>}
 */
export async function exportVault(vaultPath, password, exportPath) {
  try {
    // Load and decrypt vault
    const vault = await loadVault(vaultPath, password);
    
    // Add metadata to exported vault
    const exportData = {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      sourceVault: vaultPath,
      entries: vault.entries
    };
    
    // Write unencrypted export file
    await fs.writeFile(exportPath, JSON.stringify(exportData, null, 2), {
      mode: 0o600,
      encoding: 'utf8'
    });
    
    console.log(chalk.yellow('⚠ WARNING: This export file is UNENCRYPTED!'));
    console.log(chalk.yellow('  Keep it secure and delete it when no longer needed.'));
    
    // Wipe the vault data from memory
    secureWipe(Buffer.from(JSON.stringify(vault.entries)));
    
    // Log export operation
    await auditLogger.log('vault_export', `Exported vault to ${exportPath}`, 'success');
  } catch (error) {
    await auditLogger.log('vault_export', `Failed to export vault to ${exportPath}`, 'failure');
    throw new Error(`Failed to export vault: ${error.message}`);
  }
}

/**
 * Import vault from unencrypted JSON file
 * @param {string} importPath - Path to import file
 * @param {string} vaultPath - Path to destination vault file
 * @param {string} password - Master password for new vault
 * @returns {Promise<void>}
 */
export async function importVault(importPath, vaultPath, password, options = {}) {
  const { overwrite = false } = options;
  try {
    // Read import file
    const importData = JSON.parse(await fs.readFile(importPath, 'utf8'));
    
    // Validate import data structure
    if (!importData.entries || typeof importData.entries !== 'object') {
      throw new Error('Invalid import file format');
    }
    
    // Check if vault already exists
    if (await vaultExists(vaultPath) && !overwrite) {
      throw new Error('Vault file already exists at destination path');
    }
    
    // Create new vault with imported entries
    const now = new Date().toISOString();
    const vault = {
      entries: importData.entries,
      createdAt: now,
      updatedAt: now,
      importedAt: now,
      importSource: importPath
    };
    
    // Encrypt and save vault
    await createVault(vaultPath, password);
    await saveVault(vaultPath, password, vault);
    
    console.log(chalk.green(`✓ Imported ${Object.keys(importData.entries).length} entries`));
    
    // Securely wipe import data from memory
    secureWipe(Buffer.from(JSON.stringify(importData.entries)));
    
    // Log import operation
    await auditLogger.log('vault_import', `Imported vault from ${importPath} to ${vaultPath}`, 'success');
  } catch (error) {
    await auditLogger.log('vault_import', `Failed to import vault from ${importPath}`, 'failure');
    throw new Error(`Failed to import vault: ${error.message}`);
  }
}
