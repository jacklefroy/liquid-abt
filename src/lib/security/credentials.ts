// LIQUID ABT - Secure Credential Storage and Management
// AWS Secrets Manager and SSM Parameter Store integration with fallback to environment variables

import { SecretsManagerClient, GetSecretValueCommand, UpdateSecretCommand } from '@aws-sdk/client-secrets-manager';
import { SSMClient, GetParameterCommand, PutParameterCommand } from '@aws-sdk/client-ssm';
import { createHash, createCipher, createDecipher } from 'crypto';

// AWS clients
let secretsClient: SecretsManagerClient | null = null;
let ssmClient: SSMClient | null = null;

// Initialize AWS clients
function initializeAwsClients() {
  if (!secretsClient && process.env.AWS_REGION) {
    try {
      secretsClient = new SecretsManagerClient({ 
        region: process.env.AWS_REGION,
        credentials: process.env.AWS_ACCESS_KEY_ID ? {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!
        } : undefined
      });

      ssmClient = new SSMClient({ 
        region: process.env.AWS_REGION,
        credentials: process.env.AWS_ACCESS_KEY_ID ? {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!
        } : undefined
      });

      console.log('🔐 AWS credential clients initialized');
    } catch (error) {
      console.warn('⚠️ Failed to initialize AWS clients, falling back to environment variables:', error);
    }
  }
}

// Credential configuration
interface CredentialConfig {
  name: string;
  environment: 'development' | 'staging' | 'production';
  type: 'api_key' | 'private_key' | 'database_url' | 'jwt_secret' | 'encryption_key';
  required: boolean;
  validateFn?: (value: string) => boolean;
}

// Supported credentials
export const CREDENTIAL_CONFIGS: Record<string, CredentialConfig> = {
  // Kraken Exchange API
  KRAKEN_API_KEY: {
    name: 'kraken-api-key',
    environment: process.env.NODE_ENV as any || 'development',
    type: 'api_key',
    required: true,
    validateFn: (value) => value.length >= 20 && value.length <= 128
  },
  KRAKEN_PRIVATE_KEY: {
    name: 'kraken-private-key',
    environment: process.env.NODE_ENV as any || 'development',
    type: 'private_key',
    required: true,
    validateFn: (value) => value.length >= 40 && /^[A-Za-z0-9+/=]+$/.test(value)
  },

  // Payment Processors
  STRIPE_SECRET_KEY: {
    name: 'stripe-secret-key',
    environment: process.env.NODE_ENV as any || 'development',
    type: 'api_key',
    required: true,
    validateFn: (value) => value.startsWith('sk_') && value.length > 20
  },
  STRIPE_WEBHOOK_SECRET: {
    name: 'stripe-webhook-secret',
    environment: process.env.NODE_ENV as any || 'development',
    type: 'api_key',
    required: true,
    validateFn: (value) => value.startsWith('whsec_') && value.length > 20
  },

  // Database
  DATABASE_URL: {
    name: 'database-url',
    environment: process.env.NODE_ENV as any || 'development',
    type: 'database_url',
    required: true,
    validateFn: (value) => value.startsWith('postgresql://') && value.includes('@')
  },

  // Security
  JWT_SECRET: {
    name: 'jwt-secret',
    environment: process.env.NODE_ENV as any || 'development',
    type: 'jwt_secret',
    required: true,
    validateFn: (value) => value.length >= 32
  },
  ENCRYPTION_KEY: {
    name: 'encryption-key',
    environment: process.env.NODE_ENV as any || 'development',
    type: 'encryption_key',
    required: true,
    validateFn: (value) => value.length === 32 // 256-bit key
  }
};

// Cache for loaded credentials (in-memory only, cleared on restart)
const credentialCache = new Map<string, { value: string; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export class CredentialManager {
  constructor() {
    initializeAwsClients();
  }

  /**
   * Get credential from AWS Secrets Manager, SSM, or environment variables
   */
  async getCredential(key: string): Promise<string> {
    const config = CREDENTIAL_CONFIGS[key];
    if (!config) {
      throw new Error(`Unknown credential: ${key}`);
    }

    // Check cache first
    const cached = credentialCache.get(key);
    if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
      return cached.value;
    }

    let credential: string | null = null;

    try {
      // Try AWS Secrets Manager first (production)
      if (process.env.NODE_ENV === 'production' && secretsClient) {
        credential = await this.getFromSecretsManager(config);
      }

      // Fallback to SSM Parameter Store (staging)
      if (!credential && process.env.NODE_ENV === 'staging' && ssmClient) {
        credential = await this.getFromSSM(config);
      }

      // Fallback to environment variables (development/fallback)
      if (!credential) {
        credential = process.env[key] || null;
      }

      if (!credential) {
        if (config.required) {
          throw new Error(`Required credential ${key} not found in any storage`);
        }
        return '';
      }

      // Validate credential format
      if (config.validateFn && !config.validateFn(credential)) {
        throw new Error(`Invalid format for credential ${key}`);
      }

      // Cache the credential
      credentialCache.set(key, { value: credential, timestamp: Date.now() });

      return credential;
    } catch (error) {
      console.error(`Failed to get credential ${key}:`, error);
      
      // For required credentials, throw the error
      if (config.required) {
        throw error;
      }
      
      return '';
    }
  }

  /**
   * Store credential in appropriate storage based on environment
   */
  async setCredential(key: string, value: string): Promise<void> {
    const config = CREDENTIAL_CONFIGS[key];
    if (!config) {
      throw new Error(`Unknown credential: ${key}`);
    }

    // Validate credential format
    if (config.validateFn && !config.validateFn(value)) {
      throw new Error(`Invalid format for credential ${key}`);
    }

    try {
      // Store in AWS Secrets Manager (production)
      if (process.env.NODE_ENV === 'production' && secretsClient) {
        await this.setInSecretsManager(config, value);
      }
      // Store in SSM Parameter Store (staging)
      else if (process.env.NODE_ENV === 'staging' && ssmClient) {
        await this.setInSSM(config, value);
      }
      // Development: just warn about environment variables
      else {
        console.warn(`⚠️ Set ${key} in environment variables for development`);
      }

      // Update cache
      credentialCache.set(key, { value, timestamp: Date.now() });

      console.log(`✅ Credential ${key} updated successfully`);
    } catch (error) {
      console.error(`Failed to set credential ${key}:`, error);
      throw error;
    }
  }

  /**
   * Rotate credential (generate new value and update)
   */
  async rotateCredential(key: string): Promise<string> {
    const config = CREDENTIAL_CONFIGS[key];
    if (!config) {
      throw new Error(`Unknown credential: ${key}`);
    }

    let newValue: string;

    // Generate new credential based on type
    switch (config.type) {
      case 'jwt_secret':
      case 'encryption_key':
        newValue = this.generateSecureKey(32);
        break;
      case 'api_key':
        newValue = this.generateApiKey();
        break;
      default:
        throw new Error(`Cannot auto-rotate credential type: ${config.type}`);
    }

    // Store the new credential
    await this.setCredential(key, newValue);

    console.log(`🔄 Credential ${key} rotated successfully`);
    return newValue;
  }

  /**
   * Encrypt sensitive data using the encryption key
   */
  async encryptData(data: string): Promise<string> {
    const encryptionKey = await this.getCredential('ENCRYPTION_KEY');
    const cipher = createCipher('aes-256-cbc', encryptionKey);
    
    let encrypted = cipher.update(data, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    return encrypted;
  }

  /**
   * Decrypt sensitive data using the encryption key
   */
  async decryptData(encryptedData: string): Promise<string> {
    const encryptionKey = await this.getCredential('ENCRYPTION_KEY');
    const decipher = createDecipher('aes-256-cbc', encryptionKey);
    
    let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  }

  /**
   * Get all credentials (for health checks and validation)
   */
  async validateAllCredentials(): Promise<{ valid: boolean; missing: string[]; invalid: string[] }> {
    const missing: string[] = [];
    const invalid: string[] = [];

    for (const [key, config] of Object.entries(CREDENTIAL_CONFIGS)) {
      try {
        const value = await this.getCredential(key);
        
        if (!value && config.required) {
          missing.push(key);
        } else if (value && config.validateFn && !config.validateFn(value)) {
          invalid.push(key);
        }
      } catch (error) {
        if (config.required) {
          missing.push(key);
        }
      }
    }

    return {
      valid: missing.length === 0 && invalid.length === 0,
      missing,
      invalid
    };
  }

  /**
   * Clear credential cache (useful for testing or security)
   */
  clearCache(): void {
    credentialCache.clear();
    console.log('🧹 Credential cache cleared');
  }

  // Private methods

  private async getFromSecretsManager(config: CredentialConfig): Promise<string | null> {
    if (!secretsClient) return null;

    try {
      const secretName = `liquid-abt/${config.environment}/${config.name}`;
      const response = await secretsClient.send(new GetSecretValueCommand({
        SecretId: secretName
      }));

      return response.SecretString || null;
    } catch (error) {
      // ResourceNotFoundException is expected for missing secrets
      if ((error as any).name !== 'ResourceNotFoundException') {
        console.error('Secrets Manager error:', error);
      }
      return null;
    }
  }

  private async setInSecretsManager(config: CredentialConfig, value: string): Promise<void> {
    if (!secretsClient) throw new Error('Secrets Manager client not available');

    const secretName = `liquid-abt/${config.environment}/${config.name}`;
    
    try {
      await secretsClient.send(new UpdateSecretCommand({
        SecretId: secretName,
        SecretString: value
      }));
    } catch (error) {
      // If secret doesn't exist, this will fail - should create it first
      console.error('Failed to update secret in Secrets Manager:', error);
      throw error;
    }
  }

  private async getFromSSM(config: CredentialConfig): Promise<string | null> {
    if (!ssmClient) return null;

    try {
      const parameterName = `/liquid-abt/${config.environment}/${config.name}`;
      const response = await ssmClient.send(new GetParameterCommand({
        Name: parameterName,
        WithDecryption: true
      }));

      return response.Parameter?.Value || null;
    } catch (error) {
      // ParameterNotFound is expected for missing parameters
      if ((error as any).name !== 'ParameterNotFound') {
        console.error('SSM error:', error);
      }
      return null;
    }
  }

  private async setInSSM(config: CredentialConfig, value: string): Promise<void> {
    if (!ssmClient) throw new Error('SSM client not available');

    const parameterName = `/liquid-abt/${config.environment}/${config.name}`;
    
    try {
      await ssmClient.send(new PutParameterCommand({
        Name: parameterName,
        Value: value,
        Type: 'SecureString',
        Overwrite: true,
        Description: `LIQUID ABT ${config.type} for ${config.environment}`
      }));
    } catch (error) {
      console.error('Failed to store parameter in SSM:', error);
      throw error;
    }
  }

  private generateSecureKey(length: number): string {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    
    for (let i = 0; i < length; i++) {
      result += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    
    return result;
  }

  private generateApiKey(): string {
    return 'liquid_' + this.generateSecureKey(32) + '_' + Date.now().toString(36);
  }
}

// Singleton instance
export const credentialManager = new CredentialManager();

// Convenience functions for common credentials
export const getKrakenCredentials = async (): Promise<{ apiKey: string; privateKey: string }> => {
  return {
    apiKey: await credentialManager.getCredential('KRAKEN_API_KEY'),
    privateKey: await credentialManager.getCredential('KRAKEN_PRIVATE_KEY')
  };
};

export const getStripeCredentials = async (): Promise<{ secretKey: string; webhookSecret: string }> => {
  return {
    secretKey: await credentialManager.getCredential('STRIPE_SECRET_KEY'),
    webhookSecret: await credentialManager.getCredential('STRIPE_WEBHOOK_SECRET')
  };
};

export const getDatabaseUrl = async (): Promise<string> => {
  return await credentialManager.getCredential('DATABASE_URL');
};

export const getJwtSecret = async (): Promise<string> => {
  return await credentialManager.getCredential('JWT_SECRET');
};

// Key rotation schedule (for production use)
export class KeyRotationScheduler {
  private rotationIntervals: Map<string, NodeJS.Timeout> = new Map();

  /**
   * Schedule automatic key rotation
   */
  scheduleRotation(key: string, intervalDays: number = 90): void {
    const config = CREDENTIAL_CONFIGS[key];
    if (!config || !['jwt_secret', 'encryption_key'].includes(config.type)) {
      console.warn(`⚠️ Key ${key} cannot be automatically rotated`);
      return;
    }

    // Clear existing rotation if any
    this.clearRotation(key);

    // Schedule rotation
    const intervalMs = intervalDays * 24 * 60 * 60 * 1000;
    const timeout = setTimeout(async () => {
      try {
        await credentialManager.rotateCredential(key);
        console.log(`🔄 Automatically rotated credential: ${key}`);
        
        // Schedule next rotation
        this.scheduleRotation(key, intervalDays);
      } catch (error) {
        console.error(`Failed to auto-rotate credential ${key}:`, error);
      }
    }, intervalMs);

    this.rotationIntervals.set(key, timeout);
    console.log(`⏰ Scheduled rotation for ${key} in ${intervalDays} days`);
  }

  /**
   * Clear scheduled rotation
   */
  clearRotation(key: string): void {
    const existing = this.rotationIntervals.get(key);
    if (existing) {
      clearTimeout(existing);
      this.rotationIntervals.delete(key);
    }
  }

  /**
   * Clear all scheduled rotations
   */
  clearAllRotations(): void {
    for (const timeout of this.rotationIntervals.values()) {
      clearTimeout(timeout);
    }
    this.rotationIntervals.clear();
  }
}

export const keyRotationScheduler = new KeyRotationScheduler();