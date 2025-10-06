import crypto from 'crypto';

/**
 * Derive a 32-byte encryption key from password using scrypt
 * @param {string} password - Master password
 * @param {Buffer} salt - Salt for KDF (16 bytes)
 * @returns {Promise<Buffer>} 32-byte derived key
 */
export async function deriveKey(password, salt) {
  return new Promise((resolve, reject) => {
    // N=32768 (2^15), r=8, p=1 - good balance of security and performance
    crypto.scrypt(password, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
}

/**
 * Encrypt a JSON object with AES-256-GCM
 * @param {Object} obj - Plain object to encrypt
 * @param {string} password - Master password
 * @returns {Promise<Object>} Encrypted payload { kdf, salt, iv, authTag, data }
 */
export async function encryptJson(obj, password) {
  // Generate random salt and IV
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12); // GCM standard is 12 bytes

  // Derive key from password
  const key = await deriveKey(password, salt);

  // Convert object to JSON string then buffer
  const plaintext = Buffer.from(JSON.stringify(obj), 'utf8');

  // Create cipher
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  // Encrypt
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);

  // Get auth tag
  const authTag = cipher.getAuthTag();

  return {
    kdf: 'scrypt',
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
    data: encrypted.toString('base64')
  };
}

/**
 * Decrypt a JSON object with AES-256-GCM
 * @param {Object} payload - Encrypted payload { kdf, salt, iv, authTag, data }
 * @param {string} password - Master password
 * @returns {Promise<Object>} Decrypted object
 * @throws {Error} If decryption fails (wrong password or corrupted data)
 */
export async function decryptJson(payload, password) {
  try {
    // Parse base64 components
    const salt = Buffer.from(payload.salt, 'base64');
    const iv = Buffer.from(payload.iv, 'base64');
    const authTag = Buffer.from(payload.authTag, 'base64');
    const data = Buffer.from(payload.data, 'base64');

    // Derive key
    const key = await deriveKey(password, salt);

    // Create decipher
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);

    // Decrypt
    const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);

    // Parse JSON
    return JSON.parse(decrypted.toString('utf8'));
  } catch (error) {
    throw new Error('Decryption failed - invalid password or corrupted vault');
  }
}

/**
 * Securely overwrite a buffer with random data
 * @param {Buffer} buffer - Buffer to overwrite
 */
export function secureWipe(buffer) {
  if (buffer && Buffer.isBuffer(buffer)) {
    crypto.randomFillSync(buffer);
    buffer.fill(0);
  }
}
