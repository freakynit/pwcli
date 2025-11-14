import fs from 'fs/promises';
import path from 'path';
import os from 'os';

const CONFIG_FILE = path.join(os.homedir(), '.pwcli.json');

/**
 * Get default vault path
 * @returns {string} Default path to vault file
 */
export function getDefaultVaultPath() {
  return path.join(os.homedir(), '.pw-vault.json');
}

/**
 * Load configuration from ~/.pwcli.json
 * @returns {Promise<Object|null>} Config object or null if not exists
 */
export async function loadConfig() {
  try {
    const data = await fs.readFile(CONFIG_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null; // Config doesn't exist yet
    }
    throw error;
  }
}

/**
 * Save configuration to ~/.pwcli.json
 * @param {Object} config - Config object to save
 * @returns {Promise<void>}
 */
export async function saveConfig(config) {
  await fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2), {
    mode: 0o600,
    encoding: 'utf8'
  });
}

/**
 * Get vault path from config or return null if not configured
 * @returns {Promise<string|null>} Vault path or null
 */
export async function getVaultPath() {
  const config = await loadConfig();
  return config?.vaultPath || null;
}

/**
 * Set vault path in config
 * @param {string} vaultPath - Path to vault file
 * @returns {Promise<void>}
 */
export async function setVaultPath(vaultPath) {
  const config = await loadConfig() || {};
  config.vaultPath = path.resolve(vaultPath);
  await saveConfig(config);
}

/**
 * Check if first run (no config exists)
 * @returns {Promise<boolean>} True if first run
 */
export async function isFirstRun() {
  const config = await loadConfig();
  return !config || !config.vaultPath;
}

/**
 * Delete config file
 * @returns {Promise<void>}
 */
export async function deleteConfig() {
  try {
    await fs.unlink(CONFIG_FILE);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
    // Ignore if file doesn't exist
  }
}
