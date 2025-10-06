/**
 * Simple rate limiter for password attempts
 * Enforces minimum delay between consecutive attempts
 */

class RateLimiter {
  constructor(minDelayMs = 1000) {
    this.minDelayMs = minDelayMs;
    this.lastAttemptTime = 0;
  }

  /**
   * Wait if necessary to enforce rate limit
   * @returns {Promise<void>}
   */
  async waitIfNeeded() {
    const now = Date.now();
    const timeSinceLastAttempt = now - this.lastAttemptTime;

    if (timeSinceLastAttempt < this.minDelayMs) {
      const waitTime = this.minDelayMs - timeSinceLastAttempt;
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }

    this.lastAttemptTime = Date.now();
  }

  /**
   * Reset the rate limiter (useful after successful auth)
   */
  reset() {
    this.lastAttemptTime = 0;
  }
}

// Global rate limiter instance for password attempts (1 per second)
export const passwordRateLimiter = new RateLimiter(1000);
