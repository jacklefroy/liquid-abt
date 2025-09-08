// LIQUID ABT - Enhanced Bitcoin Address Validation
// Implementation of production-grade Bitcoin address validation with checksums

import crypto from 'crypto';

export interface AddressValidationResult {
  isValid: boolean;
  type: 'legacy' | 'segwit' | 'bech32' | null;
  network: 'mainnet' | 'testnet' | null;
  error?: string;
  warnings?: string[];
}

export class BitcoinAddressValidator {
  /**
   * Comprehensive Bitcoin address validation with checksum verification
   */
  static validateAddress(address: string): AddressValidationResult {
    if (!address || typeof address !== 'string') {
      return {
        isValid: false,
        type: null,
        network: null,
        error: 'Invalid address format'
      };
    }

    const trimmedAddress = address.trim();

    // Legacy addresses (Base58Check encoded)
    if (this.isLegacyAddress(trimmedAddress)) {
      return this.validateLegacyAddress(trimmedAddress);
    }

    // Bech32 addresses (SegWit native)
    if (this.isBech32Address(trimmedAddress)) {
      return this.validateBech32Address(trimmedAddress);
    }

    return {
      isValid: false,
      type: null,
      network: null,
      error: 'Unrecognized address format'
    };
  }

  /**
   * Check if address is Legacy format (1xxx or 3xxx)
   */
  private static isLegacyAddress(address: string): boolean {
    return /^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(address);
  }

  /**
   * Check if address is Bech32 format (bc1xxx or tb1xxx)
   */
  private static isBech32Address(address: string): boolean {
    return /^(bc1|tb1)[02-9ac-hj-np-z]{7,87}$/.test(address);
  }

  /**
   * Validate Legacy address with Base58Check checksum
   */
  private static validateLegacyAddress(address: string): AddressValidationResult {
    try {
      const decoded = this.base58CheckDecode(address);
      
      if (!decoded) {
        return {
          isValid: false,
          type: 'legacy',
          network: null,
          error: 'Invalid Base58Check encoding'
        };
      }

      const { payload, network } = decoded;
      const version = payload[0];
      
      // Determine address type based on version byte
      let type: 'legacy' | 'segwit' = 'legacy';
      let warnings: string[] = [];

      // P2PKH addresses
      if ((network === 'mainnet' && version === 0x00) || 
          (network === 'testnet' && version === 0x6f)) {
        type = 'legacy';
      }
      // P2SH addresses (could be SegWit wrapped)
      else if ((network === 'mainnet' && version === 0x05) || 
               (network === 'testnet' && version === 0xc4)) {
        type = 'segwit'; // Assume SegWit wrapped in P2SH
        warnings.push('This appears to be a SegWit address wrapped in P2SH format');
      }
      else {
        return {
          isValid: false,
          type: 'legacy',
          network,
          error: `Invalid version byte: 0x${version.toString(16)}`
        };
      }

      // Additional length validation
      if (payload.length !== 21) {
        return {
          isValid: false,
          type,
          network,
          error: `Invalid payload length: ${payload.length} (expected 21)`
        };
      }

      return {
        isValid: true,
        type,
        network,
        warnings: warnings.length > 0 ? warnings : undefined
      };

    } catch (error) {
      return {
        isValid: false,
        type: 'legacy',
        network: null,
        error: `Base58Check validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  /**
   * Validate Bech32 address with checksum
   */
  private static validateBech32Address(address: string): AddressValidationResult {
    try {
      const lowerAddress = address.toLowerCase();
      const result = this.bech32Decode(lowerAddress);
      
      if (!result) {
        return {
          isValid: false,
          type: 'bech32',
          network: null,
          error: 'Invalid Bech32 encoding'
        };
      }

      const { hrp, data } = result;
      
      // Determine network
      let network: 'mainnet' | 'testnet';
      if (hrp === 'bc') {
        network = 'mainnet';
      } else if (hrp === 'tb') {
        network = 'testnet';
      } else {
        return {
          isValid: false,
          type: 'bech32',
          network: null,
          error: `Invalid HRP: ${hrp}`
        };
      }

      // Validate witness version and program
      if (data.length < 1) {
        return {
          isValid: false,
          type: 'bech32',
          network,
          error: 'Empty data section'
        };
      }

      const witnessVersion = data[0];
      const witnessProgram = data.slice(1);

      // Current SegWit versions (0 and 1)
      if (witnessVersion > 16) {
        return {
          isValid: false,
          type: 'bech32',
          network,
          error: `Invalid witness version: ${witnessVersion}`
        };
      }

      // Validate program length based on witness version
      if (witnessVersion === 0) {
        if (witnessProgram.length !== 20 && witnessProgram.length !== 32) {
          return {
            isValid: false,
            type: 'bech32',
            network,
            error: `Invalid program length for v0: ${witnessProgram.length} (expected 20 or 32)`
          };
        }
      } else if (witnessVersion === 1) {
        if (witnessProgram.length !== 32) {
          return {
            isValid: false,
            type: 'bech32',
            network,
            error: `Invalid program length for v1: ${witnessProgram.length} (expected 32)`
          };
        }
      }

      let warnings: string[] = [];
      if (witnessVersion > 1) {
        warnings.push(`Future witness version: v${witnessVersion} - ensure wallet compatibility`);
      }

      return {
        isValid: true,
        type: 'bech32',
        network,
        warnings: warnings.length > 0 ? warnings : undefined
      };

    } catch (error) {
      return {
        isValid: false,
        type: 'bech32',
        network: null,
        error: `Bech32 validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  /**
   * Base58Check decoding with checksum verification
   */
  private static base58CheckDecode(s: string): { payload: Buffer; network: 'mainnet' | 'testnet' } | null {
    const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    const BASE = 58;

    try {
      // Decode Base58
      let num = BigInt(0);
      let multi = BigInt(1);
      
      for (let i = s.length - 1; i >= 0; i--) {
        const char = s[i];
        const charIndex = ALPHABET.indexOf(char);
        if (charIndex === -1) {
          return null; // Invalid character
        }
        num += BigInt(charIndex) * multi;
        multi *= BigInt(BASE);
      }

      // Convert to bytes
      const bytes: number[] = [];
      let tempNum = num;
      while (tempNum > 0) {
        bytes.unshift(Number(tempNum % 256n));
        tempNum = tempNum / 256n;
      }

      // Add leading zeros
      for (let i = 0; i < s.length && s[i] === '1'; i++) {
        bytes.unshift(0);
      }

      if (bytes.length < 4) {
        return null; // Too short for checksum
      }

      // Verify checksum
      const payload = bytes.slice(0, -4);
      const checksum = bytes.slice(-4);
      
      const hash1 = crypto.createHash('sha256').update(Buffer.from(payload)).digest();
      const hash2 = crypto.createHash('sha256').update(hash1).digest();
      const expectedChecksum = Array.from(hash2.slice(0, 4));

      if (!checksum.every((byte, i) => byte === expectedChecksum[i])) {
        return null; // Checksum mismatch
      }

      // Determine network based on version byte
      const version = payload[0];
      const network = (version === 0x00 || version === 0x05) ? 'mainnet' : 'testnet';

      return {
        payload: Buffer.from(payload),
        network
      };

    } catch (error) {
      return null;
    }
  }

  /**
   * Bech32 decoding with checksum verification
   */
  private static bech32Decode(bech: string): { hrp: string; data: number[] } | null {
    const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
    const GENERATOR = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];

    try {
      if (bech.length < 8 || bech.length > 90) {
        return null;
      }

      const pos = bech.lastIndexOf('1');
      if (pos < 1 || pos + 7 > bech.length || pos > 83) {
        return null;
      }

      const hrp = bech.substring(0, pos);
      const data = bech.substring(pos + 1);

      // Decode data
      const decoded: number[] = [];
      for (const char of data) {
        const value = CHARSET.indexOf(char);
        if (value === -1) {
          return null;
        }
        decoded.push(value);
      }

      // Verify checksum
      if (!this.bech32VerifyChecksum(hrp, decoded)) {
        return null;
      }

      // Convert from 5-bit to 8-bit
      const converted = this.convertBits(decoded.slice(0, -6), 5, 8, false);
      if (!converted || converted.length < 2 || converted.length > 40) {
        return null;
      }

      return {
        hrp,
        data: converted
      };

    } catch (error) {
      return null;
    }
  }

  /**
   * Verify Bech32 checksum
   */
  private static bech32VerifyChecksum(hrp: string, data: number[]): boolean {
    return this.bech32Polymod(this.bech32HrpExpand(hrp).concat(data)) === 1;
  }

  /**
   * Bech32 polymod calculation
   */
  private static bech32Polymod(values: number[]): number {
    const GENERATOR = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
    let chk = 1;
    
    for (const value of values) {
      const top = chk >> 25;
      chk = (chk & 0x1ffffff) << 5 ^ value;
      for (let i = 0; i < 5; i++) {
        chk ^= (top >> i & 1) ? GENERATOR[i] : 0;
      }
    }
    
    return chk;
  }

  /**
   * Expand HRP for Bech32 checksum calculation
   */
  private static bech32HrpExpand(hrp: string): number[] {
    const ret: number[] = [];
    for (let i = 0; i < hrp.length; i++) {
      ret.push(hrp.charCodeAt(i) >> 5);
    }
    ret.push(0);
    for (let i = 0; i < hrp.length; i++) {
      ret.push(hrp.charCodeAt(i) & 31);
    }
    return ret;
  }

  /**
   * Convert between bit groups
   */
  private static convertBits(data: number[], frombits: number, tobits: number, pad: boolean): number[] | null {
    let acc = 0;
    let bits = 0;
    const ret: number[] = [];
    const maxv = (1 << tobits) - 1;
    const max_acc = (1 << (frombits + tobits - 1)) - 1;
    
    for (const value of data) {
      if (value < 0 || (value >> frombits)) {
        return null;
      }
      acc = ((acc << frombits) | value) & max_acc;
      bits += frombits;
      while (bits >= tobits) {
        bits -= tobits;
        ret.push((acc >> bits) & maxv);
      }
    }
    
    if (pad) {
      if (bits) {
        ret.push((acc << (tobits - bits)) & maxv);
      }
    } else if (bits >= frombits || ((acc << (tobits - bits)) & maxv)) {
      return null;
    }
    
    return ret;
  }

  /**
   * Check for address reuse across tenants (security feature)
   */
  static async checkAddressReuse(address: string): Promise<{
    isReused: boolean;
    reuseCount?: number;
    warning?: string;
  }> {
    // This would query across all tenant schemas to detect address reuse
    // Implementation would require careful consideration of privacy
    
    // For now, return basic structure
    // In production, implement cross-tenant address checking with proper privacy controls
    
    return {
      isReused: false,
      reuseCount: 0
    };
  }

  /**
   * Validate address meets security requirements
   */
  static validateSecurityRequirements(address: string): {
    meetsRequirements: boolean;
    violations: string[];
    recommendations: string[];
  } {
    const violations: string[] = [];
    const recommendations: string[] = [];

    const validation = this.validateAddress(address);
    
    if (!validation.isValid) {
      violations.push('Invalid address format or checksum');
      return { meetsRequirements: false, violations, recommendations };
    }

    // Check for testnet addresses in production
    if (process.env.NODE_ENV === 'production' && validation.network === 'testnet') {
      violations.push('Testnet addresses not allowed in production');
    }

    // Recommend Bech32 for efficiency
    if (validation.type === 'legacy') {
      recommendations.push('Consider using Bech32 (bc1...) addresses for lower fees');
    }

    // Security warnings
    if (validation.warnings) {
      recommendations.push(...validation.warnings);
    }

    return {
      meetsRequirements: violations.length === 0,
      violations,
      recommendations
    };
  }
}

// Export singleton for easy use
export const bitcoinAddressValidator = BitcoinAddressValidator;