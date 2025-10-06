import clipboardy from 'clipboardy';

// Track active clipboard timers for cleanup
const activeTimers = new Set();
// Track text copied by our app for security
let lastCopiedText = null;

/**
 * Copy text to clipboard and automatically clear after specified time
 * @param {string} text - Text to copy
 * @param {Object} options - Options
 * @param {number} options.clearAfterMs - Time in ms to clear clipboard (default: 20000)
 * @returns {Promise<void>}
 */
export async function copyToClipboard(text, { clearAfterMs = 20000 } = {}) {
  await clipboardy.write(text);
  lastCopiedText = text; // Track what we copied

  // Schedule automatic clearing
  const timerId = setTimeout(async () => {
    try {
      // Only clear if the clipboard still contains our text
      const current = await clipboardy.read();
      if (current === text) {
        await clipboardy.write('');
        lastCopiedText = null;
      }
    } catch (error) {
      // Log clipboard clear failures for debugging
      console.error('Warning: Failed to auto-clear clipboard:', error.message);
    } finally {
      activeTimers.delete(timerId);
    }
  }, clearAfterMs);

  // Track timer for potential cleanup
  activeTimers.add(timerId);
}

/**
 * Clear all pending clipboard timers and secure clipboard on exit
 * @returns {Promise<void>}
 */
export async function clearAllClipboardTimers() {
  activeTimers.forEach(timerId => clearTimeout(timerId));
  activeTimers.clear();

  // Security: Clear clipboard if it contains our password
  if (lastCopiedText !== null) {
    try {
      const current = await clipboardy.read();
      if (current === lastCopiedText) {
        await clipboardy.write('');
      }
    } catch (error) {
      // Silently fail - don't block exit
    } finally {
      lastCopiedText = null;
    }
  }
}

// Handle process termination gracefully
process.on('SIGINT', async () => {
  await clearAllClipboardTimers();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await clearAllClipboardTimers();
  process.exit(0);
});
