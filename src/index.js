#!/usr/bin/env node

import chalk from 'chalk';
import ora from 'ora';
import {
  isFirstRun,
  getDefaultVaultPath,
  setVaultPath,
  getVaultPath,
  deleteConfig
} from './config.js';
import {
  createVault,
  loadVault,
  saveVault,
  listKeys,
  changeMasterPassword,
  moveVault,
  nukeVault,
  vaultExists
} from './vault.js';
import {
  runSetupWizard,
  showMainMenu,
  promptPassword,
  promptInput,
  promptFuzzySearch,
  promptEntryDetails,
  promptConfirm,
  showSuccess,
  showError,
  showWarning,
  showInfo,
  displayKeys
} from './ui.js';
import { copyToClipboard, clearAllClipboardTimers } from './clipboard.js';
import { validateEntryKey, validateVaultPath } from './validation.js';

/**
 * Handle first-run setup
 */
async function handleFirstRun() {
  try {
    const { vaultPath, password } = await runSetupWizard(getDefaultVaultPath());

    const spinner = ora('Creating encrypted vault...').start();

    await createVault(vaultPath, password);
    await setVaultPath(vaultPath);

    spinner.succeed('Vault created successfully!');
    showInfo(`Vault location: ${vaultPath}`);
    console.log('');
  } catch (error) {
    showError(error.message);
    process.exit(1);
  }
}

/**
 * Search and get password
 */
async function handleSearch() {
  let spinner;
  try {
    const vaultPath = await getVaultPath();
    const password = await promptPassword();

    spinner = ora('Decrypting vault...').start();
    const vault = await loadVault(vaultPath, password);
    spinner.stop();

    const keys = listKeys(vault.entries);
    const selectedKey = await promptFuzzySearch('Search for entry', keys);

    if (!selectedKey) {
      showWarning('Search cancelled');
      return;
    }

    const entry = vault.entries[selectedKey];

    // Show copying animation
    const copySpinner = ora('Copying to clipboard...').start();
    await copyToClipboard(entry.password);
    await new Promise(resolve => setTimeout(resolve, 500)); // Brief pause for effect
    copySpinner.succeed(chalk.green('Password copied to clipboard!'));

    console.log(chalk.red('⚠ Clipboard will be cleared in 20 seconds'));

    if (entry.username) {
      showInfo(`Username: ${entry.username}`);
    }
  } catch (error) {
    if (spinner) spinner.stop();
    showError(error.message);
  }
}

/**
 * Add new entry
 */
async function handleAdd() {
  let spinner;
  try {
    const vaultPath = await getVaultPath();
    const password = await promptPassword();

    spinner = ora('Decrypting vault...').start();
    const vault = await loadVault(vaultPath, password);
    spinner.stop();

    let key;
    while (true) {
      key = await promptInput('Entry name/key');

      // Validate entry key
      const validation = validateEntryKey(key);
      if (!validation.valid) {
        showError(validation.error);
        continue;
      }
      break;
    }

    // Check if key exists
    if (vault.entries[key]) {
      const overwrite = await promptConfirm(`Entry "${key}" already exists. Overwrite?`);
      if (!overwrite) {
        showWarning('Cancelled');
        return;
      }
    }

    const entry = await promptEntryDetails();
    vault.entries[key] = entry;

    const saveSpinner = ora('Saving vault...').start();
    await saveVault(vaultPath, password, vault);
    saveSpinner.succeed('Entry added successfully!');
  } catch (error) {
    if (spinner) spinner.stop();
    showError(error.message);
  }
}

/**
 * Update existing entry
 */
async function handleUpdate() {
  let spinner;
  try {
    const vaultPath = await getVaultPath();
    const password = await promptPassword();

    spinner = ora('Decrypting vault...').start();
    const vault = await loadVault(vaultPath, password);
    spinner.stop();

    const keys = listKeys(vault.entries);
    const selectedKey = await promptFuzzySearch('Select entry to update', keys);

    if (!selectedKey) {
      showWarning('Update cancelled');
      return;
    }

    const existing = vault.entries[selectedKey];
    console.log(chalk.cyan(`\nUpdating: ${selectedKey}`));

    const entry = await promptEntryDetails(existing);
    vault.entries[selectedKey] = entry;

    const saveSpinner = ora('Saving vault...').start();
    await saveVault(vaultPath, password, vault);
    saveSpinner.succeed('Entry updated successfully!');
  } catch (error) {
    if (spinner) spinner.stop();
    showError(error.message);
  }
}

/**
 * Delete entry
 */
async function handleDelete() {
  let spinner;
  try {
    const vaultPath = await getVaultPath();
    const password = await promptPassword();

    spinner = ora('Decrypting vault...').start();
    const vault = await loadVault(vaultPath, password);
    spinner.stop();

    const keys = listKeys(vault.entries);
    const selectedKey = await promptFuzzySearch('Select entry to delete', keys);

    if (!selectedKey) {
      showWarning('Delete cancelled');
      return;
    }

    const confirm = await promptConfirm(`Delete "${selectedKey}"?`);
    if (!confirm) {
      showWarning('Cancelled');
      return;
    }

    delete vault.entries[selectedKey];

    const saveSpinner = ora('Saving vault...').start();
    await saveVault(vaultPath, password, vault);
    saveSpinner.succeed('Entry deleted successfully!');
  } catch (error) {
    if (spinner) spinner.stop();
    showError(error.message);
  }
}

/**
 * List all keys
 */
async function handleList() {
  let spinner;
  try {
    const vaultPath = await getVaultPath();
    const password = await promptPassword();

    spinner = ora('Decrypting vault...').start();
    const vault = await loadVault(vaultPath, password);
    spinner.stop();

    const keys = listKeys(vault.entries);
    displayKeys(keys);
  } catch (error) {
    if (spinner) spinner.stop();
    showError(error.message);
  }
}

/**
 * Change master password
 */
async function handleChangeMaster() {
  let spinner;
  try {
    const vaultPath = await getVaultPath();

    console.log(chalk.yellow('\n⚠️  You are about to change the master password\n'));

    const oldPassword = await promptPassword('Current master password');
    const newPassword = await promptPassword('New master password');
    const confirmPassword = await promptPassword('Confirm new password');

    if (newPassword !== confirmPassword) {
      showError('Passwords do not match');
      return;
    }

    spinner = ora('Re-encrypting vault...').start();
    await changeMasterPassword(vaultPath, oldPassword, newPassword);
    spinner.succeed('Master password changed successfully!');
  } catch (error) {
    if (spinner) spinner.fail('Failed to change master password');
    showError(error.message);
  }
}

/**
 * Change vault location
 */
async function handleChangeFile() {
  let spinner;
  try {
    const oldPath = await getVaultPath();
    const password = await promptPassword('Master password (for verification)');

    // Verify password
    spinner = ora('Verifying password...').start();
    await loadVault(oldPath, password);
    spinner.stop();

    let newPath;
    while (true) {
      newPath = await promptInput('New vault location');

      // Validate vault path
      const validation = await validateVaultPath(newPath);
      if (!validation.valid) {
        showError(validation.error);
        continue;
      }
      break;
    }

    spinner = ora('Moving vault...').start();
    await moveVault(oldPath, newPath, password);
    await setVaultPath(newPath);

    spinner.succeed('Vault moved successfully!');
    showInfo(`New location: ${newPath}`);
  } catch (error) {
    if (spinner) spinner.fail('Failed to update vault location');
    showError(error.message);
  }
}

/**
 * Nuke vault (delete everything)
 */
async function handleNuke() {
  let spinner;
  try {
    const vaultPath = await getVaultPath();

    console.log(chalk.red.bold('\n💣 DANGER ZONE 💣\n'));
    console.log(chalk.red('You are about to permanently delete your entire password vault.'));
    console.log(chalk.red('This action is IRREVERSIBLE and will destroy ALL stored passwords.\n'));

    const password = await promptPassword('Enter master password to continue');

    // Verify password
    spinner = ora('Verifying password...').start();
    await loadVault(vaultPath, password);
    spinner.stop();

    const confirmation = await promptInput('Type "NUKE" to confirm deletion');

    if (confirmation !== 'NUKE') {
      showWarning('Cancelling - confirmation text did not match');
      return;
    }

    const finalConfirm = await promptConfirm('Are you absolutely sure?');
    if (!finalConfirm) {
      showWarning('Cancelled');
      return;
    }

    const nukeSpinner = ora('Securely wiping vault...').start();
    await nukeVault(vaultPath);
    await deleteConfig();
    nukeSpinner.succeed('Vault has been nuked');

    console.log(chalk.red('\n⚠️  All data destroyed. Run pwcli again to create a new vault.\n'));
    process.exit(0);
  } catch (error) {
    if (spinner) spinner.fail('Failed to nuke vault');
    showError(error.message);
  }
}

/**
 * Interactive menu mode
 */
async function runInteractiveMode() {
  let running = true;

  while (running) {
    try {
      console.log('');
      const action = await showMainMenu();

      switch (action) {
        case 'search':
          await handleSearch();
          break;
        case 'add':
          await handleAdd();
          break;
        case 'update':
          await handleUpdate();
          break;
        case 'delete':
          await handleDelete();
          break;
        case 'list':
          await handleList();
          break;
        case 'change-master':
          await handleChangeMaster();
          break;
        case 'change-file':
          await handleChangeFile();
          break;
        case 'nuke':
          await handleNuke();
          break;
        case 'quit':
          console.log(chalk.cyan('\n👋 Goodbye!\n'));
          await clearAllClipboardTimers();
          running = false;
          process.exit(0);
          break;
      }
    } catch (error) {
      if (error.message === 'User force closed the prompt') {
        console.log(chalk.cyan('\n\n👋 Goodbye!\n'));
        await clearAllClipboardTimers();
        running = false;
        process.exit(0);
      } else {
        showError(`Unexpected error: ${error.message}`);
      }
    }
  }
}

/**
 * Handle direct CLI commands
 */
async function handleDirectCommand(command) {
  // Check if vault exists
  const firstRun = await isFirstRun();
  if (firstRun) {
    await handleFirstRun();
  }

  switch (command) {
    case 'add':
      await handleAdd();
      break;
    case 'get':
    case 'search':
      await handleSearch();
      break;
    case 'update':
      await handleUpdate();
      break;
    case 'delete':
      await handleDelete();
      break;
    case 'list':
      await handleList();
      break;
    case 'change-master':
      await handleChangeMaster();
      break;
    case 'change-file':
      await handleChangeFile();
      break;
    case 'nuke':
      await handleNuke();
      break;
    default:
      showError(`Unknown command: ${command}`);
      console.log('Available commands: add, get, search, update, delete, list, change-master, change-file, nuke');
      process.exit(1);
  }
}

/**
 * Main entry point
 */
export async function main() {
  try {
    const args = process.argv.slice(2);

    // Check for first run
    const firstRun = await isFirstRun();

    if (firstRun) {
      await handleFirstRun();

      // If command was provided, execute it
      if (args.length > 0) {
        await handleDirectCommand(args[0]);
        return;
      }
    }

    // Check vault exists
    const vaultPath = await getVaultPath();
    const exists = await vaultExists(vaultPath);

    if (!exists) {
      showError('Vault file not found. Run pwcli to set up a new vault.');
      process.exit(1);
    }

    // Direct command mode or interactive mode
    if (args.length > 0) {
      await handleDirectCommand(args[0]);
    } else {
      await runInteractiveMode();
    }
  } catch (error) {
    if (error.message !== 'User force closed the prompt') {
      showError(error.message);
      process.exit(1);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch(async error => {
    console.error(error);
    await clearAllClipboardTimers();
    process.exit(1);
  });
