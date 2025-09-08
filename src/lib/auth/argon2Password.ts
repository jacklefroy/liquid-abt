// LIQUID ABT - Argon2 Password Hashing
// Implementation of threat model Argon2 password hashing requirement

import * as argon2 from 'argon2';
import crypto from 'crypto';

export interface PasswordHashOptions {
  type?: argon2.argon2id | argon2.argon2i | argon2.argon2d;
  memoryCost?: number; // Memory usage in KiB
  timeCost?: number;   // Number of iterations
  parallelism?: number; // Number of threads
  saltLength?: number;  // Salt length in bytes
}

export interface PasswordValidationResult {
  isValid: boolean;
  needsRehash: boolean; // If password was hashed with old parameters
  error?: string;
}

export class Argon2PasswordManager {
  private readonly defaultOptions: Required<PasswordHashOptions> = {
    type: argon2.argon2id, // Most secure variant
    memoryCost: 65536, // 64 MiB memory usage (production recommended)
    timeCost: 3,       // 3 iterations (good balance of security/performance)
    parallelism: 4,    // 4 threads
    saltLength: 32     // 32 bytes salt length
  };

  constructor(private options: PasswordHashOptions = {}) {
    this.options = { ...this.defaultOptions, ...options };
  }

  /**
   * Hash a password using Argon2id with secure parameters
   */
  async hashPassword(plainPassword: string): Promise<string> {
    try {
      // Validate password strength
      this.validatePasswordStrength(plainPassword);

      // Generate random salt
      const salt = crypto.randomBytes(this.options.saltLength || 32);

      // Hash password with Argon2id
      const hashedPassword = await argon2.hash(plainPassword, {
        type: this.options.type || argon2.argon2id,
        memoryCost: this.options.memoryCost || 65536,
        timeCost: this.options.timeCost || 3,
        parallelism: this.options.parallelism || 4,
        salt,
        raw: false // Return encoded hash string
      });

      return hashedPassword;
    } catch (error) {
      console.error('Password hashing failed:', error);
      throw new Error('Failed to hash password');
    }
  }

  /**
   * Verify a password against its hash
   */
  async verifyPassword(plainPassword: string, hashedPassword: string): Promise<PasswordValidationResult> {
    try {
      // Handle legacy bcrypt hashes during transition period
      if (hashedPassword.startsWith('$2a$') || hashedPassword.startsWith('$2b$') || hashedPassword.startsWith('$2y$')) {
        return this.verifyLegacyBcryptPassword(plainPassword, hashedPassword);
      }

      // Verify Argon2 hash
      const isValid = await argon2.verify(hashedPassword, plainPassword);
      
      // Check if hash needs updating (different parameters)
      const needsRehash = this.checkIfRehashNeeded(hashedPassword);

      return {
        isValid,
        needsRehash
      };

    } catch (error) {
      console.error('Password verification failed:', error);
      return {
        isValid: false,
        needsRehash: false,
        error: 'Password verification failed'
      };
    }
  }

  /**
   * Verify legacy bcrypt password (for migration)
   */
  private async verifyLegacyBcryptPassword(plainPassword: string, bcryptHash: string): Promise<PasswordValidationResult> {
    try {
      const bcrypt = await import('bcrypt');
      const isValid = await bcrypt.compare(plainPassword, bcryptHash);
      
      return {
        isValid,
        needsRehash: true // Always rehash bcrypt passwords to Argon2
      };
    } catch (error) {
      console.error('Legacy bcrypt verification failed:', error);
      return {
        isValid: false,
        needsRehash: false,
        error: 'Legacy password verification failed'
      };
    }
  }

  /**
   * Check if password hash needs rehashing with current parameters
   */
  private checkIfRehashNeeded(hashedPassword: string): boolean {
    try {
      // Parse Argon2 hash parameters
      const hashParts = hashedPassword.split('$');
      if (hashParts.length < 6) return true;

      const variant = hashParts[1];
      const params = hashParts[3];
      
      // Parse parameters: m=memory,t=time,p=parallelism
      const paramMap = new Map<string, number>();
      params.split(',').forEach(param => {
        const [key, value] = param.split('=');
        paramMap.set(key, parseInt(value, 10));
      });

      // Check if current parameters match our security requirements
      const currentMemory = paramMap.get('m') || 0;
      const currentTime = paramMap.get('t') || 0;
      const currentParallelism = paramMap.get('p') || 0;

      // Need rehash if parameters are below current minimums
      return (
        variant !== 'argon2id' ||
        currentMemory < (this.options.memoryCost || 65536) ||
        currentTime < (this.options.timeCost || 3) ||
        currentParallelism < (this.options.parallelism || 4)
      );

    } catch (error) {
      // If we can't parse the hash, assume it needs rehashing
      return true;
    }
  }

  /**
   * Validate password strength requirements
   */
  private validatePasswordStrength(password: string): void {
    if (!password || password.length < 8) {
      throw new Error('Password must be at least 8 characters long');
    }

    if (password.length > 128) {
      throw new Error('Password must be less than 128 characters');
    }

    // Check for common weak patterns
    const commonPatterns = [
      /^(.)\1+$/, // All same character
      /^(01234567|12345678|87654321)/, // Sequential numbers
      /^(abcdefgh|qwertyui)/, // Sequential letters
      /^password/i,
      /^123456/,
      /^qwerty/i
    ];

    for (const pattern of commonPatterns) {
      if (pattern.test(password)) {
        throw new Error('Password contains common weak patterns');
      }
    }

    // Require complexity (at least 3 of 4 character types)
    let complexity = 0;
    if (/[a-z]/.test(password)) complexity++;
    if (/[A-Z]/.test(password)) complexity++;
    if (/[0-9]/.test(password)) complexity++;
    if (/[^a-zA-Z0-9]/.test(password)) complexity++;

    if (complexity < 3) {
      throw new Error('Password must contain at least 3 of: lowercase, uppercase, numbers, special characters');
    }
  }

  /**
   * Generate a secure random password
   */
  generateSecurePassword(length: number = 16): string {
    const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()_+-=[]{}|;:,.<>?';
    let password = '';

    // Ensure at least one character from each required type
    const required = [
      'abcdefghijklmnopqrstuvwxyz',
      'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
      '0123456789',
      '!@#$%^&*()_+-=[]{}|;:,.<>?'
    ];

    // Add one character from each required type
    for (const chars of required) {
      if (password.length < length) {
        password += chars.charAt(crypto.randomInt(chars.length));
      }
    }

    // Fill remaining length with random characters
    while (password.length < length) {
      password += charset.charAt(crypto.randomInt(charset.length));
    }

    // Shuffle the password to avoid predictable patterns
    return password.split('').sort(() => crypto.randomInt(3) - 1).join('');
  }

  /**
   * Test password hashing performance (for tuning parameters)
   */
  async benchmarkHashing(testPassword: string = 'test_password_123!', iterations: number = 5): Promise<{
    averageTime: number;
    minTime: number;
    maxTime: number;
    recommendations: string[];
  }> {
    const times: number[] = [];
    
    for (let i = 0; i < iterations; i++) {
      const start = process.hrtime.bigint();
      await this.hashPassword(testPassword + i); // Slightly different each time
      const end = process.hrtime.bigint();
      times.push(Number(end - start) / 1_000_000); // Convert to milliseconds
    }

    const averageTime = times.reduce((sum, time) => sum + time, 0) / times.length;
    const minTime = Math.min(...times);
    const maxTime = Math.max(...times);

    const recommendations: string[] = [];
    
    if (averageTime < 250) {
      recommendations.push('Consider increasing memoryCost or timeCost for better security');
    } else if (averageTime > 2000) {
      recommendations.push('Consider decreasing memoryCost or timeCost for better performance');
    } else {
      recommendations.push('Password hashing performance is within acceptable range (250ms-2s)');
    }

    return {
      averageTime,
      minTime,
      maxTime,
      recommendations
    };
  }

  /**
   * Get current configuration parameters
   */
  getConfiguration(): Required<PasswordHashOptions> {
    return { ...this.defaultOptions, ...this.options };
  }
}

// Export singleton instance with production-optimized settings
export const passwordManager = new Argon2PasswordManager();

// Export function to create instance with custom settings
export function createPasswordManager(options: PasswordHashOptions): Argon2PasswordManager {
  return new Argon2PasswordManager(options);
}