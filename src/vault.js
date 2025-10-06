import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import lockfile from 'proper-lockfile';
import { encryptJson, decryptJson } from './crypto.js';
import { passwordRateLimiter } from './ratelimit.js';

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
  await fs.writeFile(vaultPath, JSON.stringify(encrypted, null, 2), 'utf8');
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
    passwordRateLimiter.reset();
    return decrypted;
  } catch (error) {
    // Don't reset on failure - continue rate limiting
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
      stale: 10000
    });
  } catch (error) {
    // File might not exist yet (first save)
    if (error.code !== 'ENOENT') {
      throw new Error('Failed to acquire lock on vault file');
    }
  }

  try {
    const encrypted = await encryptJson(vault, password);
    await fs.writeFile(vaultPath, JSON.stringify(encrypted, null, 2), 'utf8');
  } finally {
    if (release) {
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
  // Decrypt with old password
  const vault = await loadVault(vaultPath, oldPassword);

  // Re-encrypt with new password (generates new salt and IV)
  await saveVault(vaultPath, newPassword, vault);
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

    // Overwrite with zeros
    await fs.writeFile(vaultPath, Buffer.alloc(size, 0));

    // Delete file
    await fs.unlink(vaultPath);
  } catch (error) {
    throw new Error(`Failed to nuke vault: ${error.message}`);
  }
}
