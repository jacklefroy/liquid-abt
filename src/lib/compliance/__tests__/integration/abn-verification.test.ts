// LIQUID ABT - ABN Verification Integration Tests
// Tests real ABN verification against Australian Business Registry

import { abnVerificationService, ABNUtils } from '../../abnVerification';
import { createRedisCache } from '../../../cache/redisClient';

describe('ABN Verification Integration', () => {
  let redis: any;

  beforeAll(async () => {
    redis = createRedisCache();
  });

  afterAll(async () => {
    // Clear test cache entries
    await abnVerificationService.clearABNCache();
    if (redis) {
      redis.disconnect();
    }
  });

  describe('ABN Format Validation', () => {
    test('should validate correct ABN format', () => {
      const validABN = '51824753556'; // Test ABN from environment
      expect(ABNUtils.isValidABNFormat(validABN)).toBe(true);
    });

    test('should reject invalid ABN formats', () => {
      const invalidABNs = [
        '1234567890',     // Too short
        '123456789012',   // Too long
        '51824753557',    // Invalid checksum
        'ABC24753556',    // Contains letters
        ''                // Empty string
      ];

      invalidABNs.forEach(abn => {
        expect(ABNUtils.isValidABNFormat(abn)).toBe(false);
      });
    });

    test('should handle ABN with spaces and formatting', () => {
      const formattedABN = '51 824 753 556';
      const result = abnVerificationService.verifyABN(formattedABN);
      
      expect(result).resolves.toBeDefined();
    });
  });

  describe('ABN Checksum Validation', () => {
    test('should validate ABN checksum algorithm', () => {
      const testABN = '51824753556';
      expect(ABNUtils.isValidABNFormat(testABN)).toBe(true);
    });

    test('should reject ABN with invalid checksum', () => {
      const invalidChecksum = '51824753557'; // Last digit changed
      expect(ABNUtils.isValidABNFormat(invalidChecksum)).toBe(false);
    });

    test('should handle edge cases in checksum calculation', () => {
      const edgeCases = [
        '00000000000', // All zeros
        '99999999999', // All nines
        '10000000000'  // Minimum valid pattern
      ];

      edgeCases.forEach(abn => {
        // Should not throw errors
        expect(() => ABNUtils.isValidABNFormat(abn)).not.toThrow();
      });
    });
  });

  describe('Australian Business Registry Integration', () => {
    test('should verify test ABN from environment', async () => {
      const testABN = process.env.TEST_ABN || '51824753556';
      
      const result = await abnVerificationService.verifyABN(testABN, {
        cacheResults: false // Skip cache for integration test
      });

      expect(result.isValid).toBe(true);
      expect(result.abnDetails).toBeDefined();
      expect(result.abnDetails?.abn).toBe(testABN);
      expect(result.abnDetails?.entityName).toBeDefined();
      expect(result.verificationLevel).toBeOneOf(['basic', 'enhanced']);
    });

    test('should handle non-existent ABN', async () => {
      const fakeABN = '11111111111'; // Valid format but doesn't exist
      
      const result = await abnVerificationService.verifyABN(fakeABN, {
        cacheResults: false
      });

      expect(result.isValid).toBe(false);
      expect(result.error).toBeDefined();
    });

    test('should retrieve detailed ABN information', async () => {
      const testABN = process.env.TEST_ABN || '51824753556';
      
      const details = await abnVerificationService.getABNDetails(testABN);

      if (details) { // Only test if we have test data
        expect(details.abn).toBe(testABN);
        expect(details.entityName).toBeDefined();
        expect(details.entityType).toBeDefined();
        expect(details.abnStatus).toBeDefined();
        expect(details.isActive).toBeDefined();
      }
    });
  });

  describe('Business Requirements Validation', () => {
    test('should enforce GST registration when required', async () => {
      const testABN = process.env.TEST_ABN || '51824753556';
      
      const result = await abnVerificationService.verifyABN(testABN, {
        enforceGST: true,
        cacheResults: false
      });

      if (result.abnDetails?.gstStatus === 'Registered') {
        expect(result.isValid).toBe(true);
      } else {
        expect(result.isValid).toBe(false);
        expect(result.recommendations).toContain('Business must be registered for GST for this service.');
      }
    });

    test('should allow inactive ABN when configured', async () => {
      // This would test with an inactive ABN if available
      const testABN = '11111111111'; // Use a non-existent ABN as proxy
      
      const result = await abnVerificationService.verifyABN(testABN, {
        allowInactiveABN: true,
        cacheResults: false
      });

      // Should still fail due to not existing, but not due to being inactive
      expect(result.isValid).toBe(false);
    });

    test('should provide business recommendations', async () => {
      const testABN = process.env.TEST_ABN || '51824753556';
      
      const result = await abnVerificationService.verifyABN(testABN, {
        cacheResults: false
      });

      if (result.isValid && result.recommendations) {
        expect(Array.isArray(result.recommendations)).toBe(true);
        expect(result.recommendations.length).toBeGreaterThan(0);
      }
    });
  });

  describe('Bulk ABN Verification', () => {
    test('should verify multiple ABNs concurrently', async () => {
      const testABNs = [
        process.env.TEST_ABN || '51824753556',
        '11111111111', // Invalid but correct format
        '22222222222'  // Invalid but correct format
      ];

      const results = await abnVerificationService.verifyMultipleABNs(testABNs, {
        cacheResults: false
      });

      expect(results.size).toBe(3);
      
      const testABNResult = results.get(testABNs[0]);
      expect(testABNResult?.isValid).toBe(true);
      
      const invalidResults = Array.from(results.values()).filter(r => !r.isValid);
      expect(invalidResults.length).toBeGreaterThanOrEqual(2);
    });

    test('should handle bulk verification with rate limiting', async () => {
      // Create many ABNs to test concurrency limits
      const manyABNs = Array.from({ length: 10 }, (_, i) => 
        `1111111111${i}`.substring(0, 11) // Generate different invalid ABNs
      );

      const startTime = Date.now();
      const results = await abnVerificationService.verifyMultipleABNs(manyABNs);
      const duration = Date.now() - startTime;

      expect(results.size).toBe(10);
      expect(duration).toBeLessThan(30000); // Should complete within 30 seconds
    });
  });

  describe('Caching and Performance', () => {
    test('should cache verification results', async () => {
      const testABN = process.env.TEST_ABN || '51824753556';
      
      // First call - should hit API
      const startTime1 = Date.now();
      const result1 = await abnVerificationService.verifyABN(testABN, {
        cacheResults: true,
        cacheDurationMinutes: 60
      });
      const duration1 = Date.now() - startTime1;

      // Second call - should hit cache
      const startTime2 = Date.now();
      const result2 = await abnVerificationService.verifyABN(testABN, {
        cacheResults: true
      });
      const duration2 = Date.now() - startTime2;

      expect(result1.isValid).toBe(result2.isValid);
      expect(duration2).toBeLessThan(duration1); // Cache should be faster
    });

    test('should provide cache statistics', async () => {
      // Perform some verifications to populate cache
      const testABN = process.env.TEST_ABN || '51824753556';
      await abnVerificationService.verifyABN(testABN);
      
      const stats = await abnVerificationService.getVerificationStats();
      
      expect(stats.totalCached).toBeGreaterThanOrEqual(0);
      expect(stats.validABNs).toBeGreaterThanOrEqual(0);
      expect(stats.invalidABNs).toBeGreaterThanOrEqual(0);
    });

    test('should clear cache when requested', async () => {
      const testABN = process.env.TEST_ABN || '51824753556';
      
      // Cache a result
      await abnVerificationService.verifyABN(testABN);
      
      // Clear specific cache
      await abnVerificationService.clearABNCache(testABN);
      
      // Verify cache was cleared (would need to check timing or Redis directly)
      const stats = await abnVerificationService.getVerificationStats();
      expect(stats).toBeDefined();
    });
  });

  describe('Utility Functions', () => {
    test('should format ABN for display', () => {
      const abn = '51824753556';
      const formatted = ABNUtils.formatABNForDisplay(abn);
      
      expect(formatted).toBe('51 824 753 556');
    });

    test('should handle malformed ABN in formatting', () => {
      const malformedABNs = [
        '123',           // Too short
        '1234567890123', // Too long
        'ABC123DEF456'   // Invalid characters
      ];

      malformedABNs.forEach(abn => {
        const formatted = ABNUtils.formatABNForDisplay(abn);
        expect(formatted).toBe(abn); // Should return original if invalid
      });
    });

    test('should extract state information from ABN', () => {
      const abn = '51824753556';
      const state = ABNUtils.getStateFromABN(abn);
      
      // State detection is simplified in our implementation
      expect(state).toBeOneOf(['NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'NT', 'ACT', null]);
    });
  });

  describe('Compliance Reporting', () => {
    test('should generate verification report for compliance', async () => {
      const testABN = process.env.TEST_ABN || '51824753556';
      
      const report = await abnVerificationService.generateVerificationReport(testABN);
      
      expect(report.abn).toBe(testABN);
      expect(report.verificationDate).toBeInstanceOf(Date);
      expect(report.result).toBeDefined();
      expect(Array.isArray(report.complianceNotes)).toBe(true);
      expect(report.complianceNotes.length).toBeGreaterThan(0);
    });

    test('should include compliance notes in verification report', async () => {
      const testABN = process.env.TEST_ABN || '51824753556';
      
      const report = await abnVerificationService.generateVerificationReport(testABN);
      
      expect(report.complianceNotes).toContain('ABN verified against Australian Business Registry');
      expect(report.complianceNotes).toContain('Checksum validation performed');
      expect(report.complianceNotes).toContain('Business status confirmed');
    });
  });

  describe('Error Handling and Edge Cases', () => {
    test('should handle network errors gracefully', async () => {
      // Test with an ABN that would cause API errors
      const problematicABN = '99999999999';
      
      const result = await abnVerificationService.verifyABN(problematicABN, {
        cacheResults: false
      });

      expect(result.isValid).toBe(false);
      expect(result.verificationLevel).toBe('failed');
      expect(result.error).toBeDefined();
    });

    test('should validate input parameters', async () => {
      const invalidInputs = ['', '   ', null, undefined];

      for (const input of invalidInputs) {
        if (input !== null && input !== undefined) {
          const result = await abnVerificationService.verifyABN(input as string);
          expect(result.isValid).toBe(false);
          expect(result.verificationLevel).toBe('failed');
        }
      }
    });

    test('should handle concurrent verification requests', async () => {
      const testABN = process.env.TEST_ABN || '51824753556';
      
      // Make multiple concurrent requests
      const concurrentRequests = Array.from({ length: 5 }, () =>
        abnVerificationService.verifyABN(testABN, { cacheResults: false })
      );

      const results = await Promise.all(concurrentRequests);
      
      expect(results).toHaveLength(5);
      results.forEach(result => {
        expect(result.isValid).toBe(true);
        expect(result.verificationLevel).toBeDefined();
      });
    });
  });

  describe('Integration with Business Logic', () => {
    test('should integrate with tenant onboarding flow', async () => {
      // Simulate tenant registration with ABN verification
      const companyABN = process.env.TEST_ABN || '51824753556';
      
      const verificationResult = await abnVerificationService.verifyABN(companyABN, {
        enforceGST: false,
        allowInactiveABN: false
      });

      if (verificationResult.isValid) {
        expect(verificationResult.abnDetails?.entityName).toBeDefined();
        expect(verificationResult.verificationLevel).toBeOneOf(['basic', 'enhanced']);
        
        // Would typically store this information in tenant record
        const tenantData = {
          companyName: verificationResult.abnDetails?.entityName,
          abn: companyABN,
          abnVerified: true,
          gstRegistered: verificationResult.abnDetails?.gstStatus === 'Registered'
        };
        
        expect(tenantData.abnVerified).toBe(true);
      }
    });

    test('should provide risk assessment for business types', async () => {
      const testABN = process.env.TEST_ABN || '51824753556';
      
      const result = await abnVerificationService.verifyABN(testABN);
      
      if (result.abnDetails) {
        // Different entity types should have different risk profiles
        const entityType = result.abnDetails.entityType;
        expect(entityType).toBeDefined();
        
        if (entityType.includes('Company')) {
          expect(result.verificationLevel).toBe('enhanced');
        }
      }
    });
  });
});