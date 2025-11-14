import fs from 'fs/promises';
import path from 'path';
import os from 'os';

/**
 * Persistent rate limiter for password attempts
 * Enforces minimum delay between consecutive attempts using file-based storage
 * Prevents bypass by process restart
 */

class PersistentRateLimiter {
  constructor(minDelayMs = 1000) {
    this.minDelayMs = minDelayMs;
    this.attemptsFile = path.join(os.tmpdir(), '.pwcli-attempts');
    this.maxFailedAttempts = 10;
    this.lockoutDuration = 300000; // 5 minutes lockout after max failures
  }

  /**
   * Wait if necessary to enforce rate limit
   * @returns {Promise<void>}
   */
  async waitIfNeeded() {
    try {
      const attempts = await this.getAttempts();
      const now = Date.now();
      
      // Check if currently locked out
      if (attempts.lockedUntil && now < attempts.lockedUntil) {
        const waitTime = attempts.lockedUntil - now;
        throw new Error(`Too many failed attempts. Locked out for ${Math.ceil(waitTime / 60000)} more minutes.`);
      }

      // Check if we need to wait due to recent attempts
      if (attempts.lastAttempt && (now - attempts.lastAttempt) < this.minDelayMs) {
        const waitTime = this.minDelayMs - (now - attempts.lastAttempt);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }

      return true;
    } catch (error) {
      if (error.message.includes('locked out')) {
        throw error;
      }
      // If file operations fail, fall back to in-memory rate limiting
      return false;
    }
  }

  /**
   * Record a failed attempt
   */
  async recordFailure() {
    try {
      const attempts = await this.getAttempts();
      const now = Date.now();
      
      // Reset if enough time has passed since last attempt
      if (attempts.lastAttempt && (now - attempts.lastAttempt) > this.minDelayMs * 2) {
        attempts.failedAttempts = 0;
      }

      attempts.lastAttempt = now;
      attempts.failedAttempts = (attempts.failedAttempts || 0) + 1;

      // Check if we should lock out
      if (attempts.failedAttempts >= this.maxFailedAttempts) {
        attempts.lockedUntil = now + this.lockoutDuration;
        console.warn('Rate limit exceeded. Locked out for 5 minutes.');
      }

      await this.saveAttempts(attempts);
    } catch (error) {
      // Silently fail if file operations don't work
      console.warn('Could not record rate limit attempt:', error.message);
    }
  }

  /**
   * Reset the rate limiter (useful after successful auth)
   */
  async reset() {
    try {
      await fs.unlink(this.attemptsFile);
    } catch (error) {
      // Ignore if file doesn't exist
    }
  }

  /**
   * Get attempts data from file
   */
  async getAttempts() {
    try {
      const data = await fs.readFile(this.attemptsFile, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      if (error.code === 'ENOENT') {
        return { lastAttempt: 0, failedAttempts: 0, lockedUntil: 0 };
      }
      throw error;
    }
  }

  /**
   * Save attempts data to file
   */
  async saveAttempts(attempts) {
    const data = JSON.stringify(attempts, null, 2);
    await fs.writeFile(this.attemptsFile, data, { mode: 0o600 });
  }

  /**
   * Get lockout status
   */
  async getStatus() {
    try {
      const attempts = await this.getAttempts();
      const now = Date.now();
      
      if (attempts.lockedUntil && now < attempts.lockedUntil) {
        return {
          locked: true,
          lockedUntil: attempts.lockedUntil,
          remainingMs: attempts.lockedUntil - now,
          failedAttempts: attempts.failedAttempts
        };
      }
      
      return {
        locked: false,
        lastAttempt: attempts.lastAttempt,
        failedAttempts: attempts.failedAttempts
      };
    } catch (error) {
      return { locked: false, error: error.message };
    }
  }
}

// Global rate limiter instance for password attempts (1 per second)
export const passwordRateLimiter = new PersistentRateLimiter(1000);
