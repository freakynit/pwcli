import enquirer from 'enquirer';
import Fuse from 'fuse.js';
import chalk from 'chalk';
import { validateVaultPath } from './validation.js';

const { Select, Input, Password, Confirm, AutoComplete } = enquirer;

/**
 * Prompt for text input
 * @param {string} message - Prompt message
 * @param {Object} options - Additional options
 * @returns {Promise<string>} User input
 */
export async function promptInput(message, options = {}) {
  const prompt = new Input({
    message,
    ...options
  });
  return await prompt.run();
}

/**
 * Prompt for password (masked input)
 * @param {string} message - Prompt message
 * @returns {Promise<string>} User input
 */
export async function promptPassword(message = 'Enter master password') {
  const prompt = new Password({
    message
  });
  return await prompt.run();
}

/**
 * Prompt for confirmation
 * @param {string} message - Prompt message
 * @returns {Promise<boolean>} User response
 */
export async function promptConfirm(message) {
  const prompt = new Confirm({
    message
  });
  return await prompt.run();
}

/**
 * Prompt for selection from list
 * @param {string} message - Prompt message
 * @param {string[]} choices - Array of choices
 * @returns {Promise<string>} Selected choice
 */
export async function promptSelect(message, choices) {
  const prompt = new Select({
    message,
    choices
  });
  return await prompt.run();
}

/**
 * Fuzzy search with live suggestions
 * @param {string} message - Prompt message
 * @param {string[]} choices - Array of choices to search
 * @returns {Promise<string|null>} Selected choice or null if cancelled
 */
export async function promptFuzzySearch(message, choices) {
  if (choices.length === 0) {
    console.log(chalk.yellow('No entries found in vault.'));
    return null;
  }

  // Sort choices alphabetically
  const sortedChoices = [...choices].sort();

  try {
    const prompt = new AutoComplete({
      message,
      limit: 10,
      choices: sortedChoices,
      suggest: (input, choices) => {
        if (!input) return choices;

        // Use Fuse.js for fuzzy matching
        const fuse = new Fuse(choices, {
          threshold: 0.4,
          distance: 100,
          includeScore: false,
          shouldSort: true,
          ignoreLocation: true
        });

        const results = fuse.search(input);
        const matches = results.map(r => r.item);

        // If no matches, return all choices to avoid empty list
        return matches.length > 0 ? matches : choices;
      }
    });

    return await prompt.run();
  } catch (error) {
    // User pressed Ctrl+C or ESC
    return null;
  }
}

/**
 * Display main menu
 * @returns {Promise<string>} Selected action
 */
export async function showMainMenu() {
  const choices = [
    { name: 'search', message: '🔍 Search / Get password' },
    { name: 'add', message: '➕ Add entry' },
    { name: 'update', message: '✏️  Update entry' },
    { name: 'delete', message: '🗑️  Delete entry' },
    { name: 'list', message: '📋 List all keys' },
    { name: 'change-master', message: '🔐 Change master password' },
    { name: 'change-file', message: '📁 Change vault location' },
    { name: 'nuke', message: '💣 Nuke all (DANGER)' },
    { name: 'quit', message: '👋 Quit' }
  ];

  const prompt = new Select({
    message: 'What would you like to do?',
    choices: choices.map(c => c.message),
    result(name) {
      return choices.find(c => c.message === name).name;
    }
  });

  return await prompt.run();
}

/**
 * Prompt for entry details (add/update)
 * @param {Object} existing - Existing entry data (for updates)
 * @returns {Promise<Object>} Entry data { username?, password }
 */
export async function promptEntryDetails(existing = {}) {
  const username = await promptInput('Username (optional)', {
    initial: existing.username || ''
  });

  const password = await promptPassword('Password');

  const entry = { password };
  if (username) {
    entry.username = username;
  }

  return entry;
}

/**
 * Display success message
 * @param {string} message - Message to display
 */
export function showSuccess(message) {
  console.log(chalk.green('✓ ' + message));
}

/**
 * Display error message
 * @param {string} message - Message to display
 */
export function showError(message) {
  console.log(chalk.red('✗ ' + message));
}

/**
 * Display warning message
 * @param {string} message - Message to display
 */
export function showWarning(message) {
  console.log(chalk.yellow('⚠ ' + message));
}

/**
 * Display info message
 * @param {string} message - Message to display
 */
export function showInfo(message) {
  console.log(chalk.blue('ℹ ' + message));
}

/**
 * First-run setup wizard
 * @returns {Promise<Object>} Setup data { vaultPath, password }
 */
export async function runSetupWizard(defaultPath) {
  console.log(chalk.bold.cyan('\n🔐 Welcome to pwcli - Secure Password Manager\n'));
  console.log('First-time setup:\n');

  let vaultPath;
  while (true) {
    vaultPath = await promptInput('Vault file location', {
      initial: defaultPath
    });

    // Validate vault path
    const validation = await validateVaultPath(vaultPath);
    if (!validation.valid) {
      console.log(chalk.red('✗ ' + validation.error));
      continue;
    }
    break;
  }

  console.log('');
  const password = await promptPassword('Create master password');
  const passwordConfirm = await promptPassword('Confirm master password');

  if (password !== passwordConfirm) {
    throw new Error('Passwords do not match');
  }

  return { vaultPath, password };
}

/**
 * Display list of keys in a formatted way
 * @param {string[]} keys - Array of keys
 */
export function displayKeys(keys) {
  if (keys.length === 0) {
    console.log(chalk.yellow('No entries in vault.'));
    return;
  }

  console.log(chalk.bold(`\nFound ${keys.length} entries:\n`));
  keys.forEach((key, index) => {
    console.log(`  ${chalk.gray((index + 1).toString().padStart(3))}. ${chalk.cyan(key)}`);
  });
  console.log('');
}
