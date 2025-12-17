import { EnhancedAttestationService, AttestationQuote } from './enhanced-attestation.service';
import { PCRBaselineService } from './pcr-baseline.service';
import { createSign, createHash, generateKeyPairSync } from 'crypto';

// Mock PCR Baseline Service
jest.mock('./pcr-baseline.service');

describe('EnhancedAttestationService', () => {
  let service: EnhancedAttestationService;
  let mockPCRService: jest.Mocked<PCRBaselineService>;
  let rsaKeyPair: { publicKey: Buffer; privateKey: Buffer };

  const sampleHardwareProfile = {
    cpuModel: 'Intel Core i7-12700K',
    biosVendor: 'American Megatrends',
    biosVersion: '2.14',
    osName: 'Ubuntu',
    osVersion: '22.04',
    kernelVersion: '5.15.0-76-generic',
    tpmVersion: '2.0',
  };

  const samplePCRValues = {
    pcr0: 'a'.repeat(64),
    pcr1: 'b'.repeat(64),
    pcr2: 'c'.repeat(64),
    pcr3: 'd'.repeat(64),
    pcr4: 'e'.repeat(64),
    pcr5: 'f'.repeat(64),
    pcr6: '0'.repeat(64),
    pcr7: '1'.repeat(64),
    pcr8: '2'.repeat(64),
    pcr9: '3'.repeat(64),
    pcr10: '4'.repeat(64),
  };

  beforeAll(() => {
    // Generate RSA key pair for testing
    const { publicKey, privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'der' },
      privateKeyEncoding: { type: 'pkcs8', format: 'der' },
    });

    rsaKeyPair = {
      publicKey: publicKey as Buffer,
      privateKey: privateKey as Buffer,
    };
  });

  beforeEach(() => {
    mockPCRService = {
      verifyAttestation: jest.fn(),
      registerBaseline: jest.fn(),
      close: jest.fn(),
    } as any;

    (PCRBaselineService as jest.MockedClass<typeof PCRBaselineService>).mockImplementation(
      () => mockPCRService
    );

    service = new EnhancedAttestationService('redis://localhost:6379');
  });

  afterEach(async () => {
    await service.close();
  });

  /**
   * Helper function to create a valid attestation quote
   */
  function createValidQuote(nonce: string): AttestationQuote {
    const timestamp = Math.floor(Date.now() / 1000);

    // Reconstruct signed data
    const parts: Buffer[] = [];

    // Timestamp
    const timestampBuffer = Buffer.allocUnsafe(8);
    timestampBuffer.writeBigUInt64BE(BigInt(timestamp));
    parts.push(timestampBuffer);

    // Nonce
    parts.push(Buffer.from(nonce, 'base64'));

    // PCR values
    for (const [key, value] of Object.entries(samplePCRValues).sort()) {
      parts.push(Buffer.from(value, 'hex'));
    }

    // Hardware profile hash
    const profileHash = createHash('sha256')
      .update(JSON.stringify(sampleHardwareProfile))
      .digest();
    parts.push(profileHash);

    const signedData = Buffer.concat(parts);

    // Sign with private key
    const signer = createSign('RSA-SHA256');
    signer.update(signedData);
    signer.end();
    const signature = signer.sign({
      key: rsaKeyPair.privateKey,
      format: 'der',
      type: 'pkcs8',
    });

    return {
      signature: signature.toString('base64'),
      publicKey: rsaKeyPair.publicKey.toString('base64'),
      publicKeyAlgorithm: 'RSA',
      pcrValues: samplePCRValues,
      timestamp,
      nonce,
      hardwareProfile: sampleHardwareProfile,
    };
  }

  describe('verifyAttestation', () => {
    it('should accept valid attestation with all checks passing', async () => {
      const nonce = Buffer.from('test-nonce-12345678901234567890').toString('base64');
      const quote = createValidQuote(nonce);

      mockPCRService.verifyAttestation.mockResolvedValue({
        isValid: true,
        deviations: [],
        riskScore: 0,
        recommendation: 'ACCEPT',
      });

      const result = await service.verifyAttestation(quote, nonce);

      expect(result.isValid).toBe(true);
      expect(result.reason).toBe('Attestation verified successfully');
      expect(result.nonceVerification?.passed).toBe(true);
      expect(result.timestampVerification?.passed).toBe(true);
      expect(result.signatureVerification?.passed).toBe(true);
      expect(result.pcrVerification?.passed).toBe(true);
    });

    it('should reject attestation with incorrect nonce', async () => {
      const nonce = Buffer.from('test-nonce-12345678901234567890').toString('base64');
      const wrongNonce = Buffer.from('wrong-nonce-12345678901234567890').toString('base64');
      const quote = createValidQuote(nonce);

      const result = await service.verifyAttestation(quote, wrongNonce);

      expect(result.isValid).toBe(false);
      expect(result.reason).toContain('Nonce verification failed');
      expect(result.nonceVerification?.passed).toBe(false);
    });

    it('should reject replay attack (reused nonce)', async () => {
      const nonce = Buffer.from('test-nonce-12345678901234567890').toString('base64');
      const quote = createValidQuote(nonce);

      mockPCRService.verifyAttestation.mockResolvedValue({
        isValid: true,
        deviations: [],
        riskScore: 0,
        recommendation: 'ACCEPT',
      });

      // First attestation should succeed
      const result1 = await service.verifyAttestation(quote, nonce);
      expect(result1.isValid).toBe(true);

      // Second attestation with same nonce should fail
      const result2 = await service.verifyAttestation(quote, nonce);
      expect(result2.isValid).toBe(false);
      expect(result2.reason).toContain('replay attack');
    });

    it('should reject attestation with old timestamp', async () => {
      const nonce = Buffer.from('test-nonce-12345678901234567890').toString('base64');
      const quote = createValidQuote(nonce);

      // Make timestamp 120 seconds old (beyond 60-second window)
      quote.timestamp = Math.floor(Date.now() / 1000) - 120;

      const result = await service.verifyAttestation(quote, nonce);

      expect(result.isValid).toBe(false);
      expect(result.reason).toContain('Timestamp verification failed');
      expect(result.timestampVerification?.passed).toBe(false);
      expect(result.timestampVerification?.age).toBeGreaterThan(60);
    });

    it('should reject attestation with future timestamp', async () => {
      const nonce = Buffer.from('test-nonce-12345678901234567890').toString('base64');
      const quote = createValidQuote(nonce);

      // Make timestamp in the future
      quote.timestamp = Math.floor(Date.now() / 1000) + 60;

      const result = await service.verifyAttestation(quote, nonce);

      expect(result.isValid).toBe(false);
      expect(result.reason).toContain('Timestamp verification failed');
      expect(result.timestampVerification?.passed).toBe(false);
    });

    it('should reject attestation with invalid signature', async () => {
      const nonce = Buffer.from('test-nonce-12345678901234567890').toString('base64');
      const quote = createValidQuote(nonce);

      // Tamper with signature
      quote.signature = Buffer.from('invalid-signature').toString('base64');

      const result = await service.verifyAttestation(quote, nonce);

      expect(result.isValid).toBe(false);
      expect(result.reason).toContain('TPM signature verification failed');
      expect(result.signatureVerification?.passed).toBe(false);
    });

    it('should reject attestation with critical PCR deviations', async () => {
      const nonce = Buffer.from('test-nonce-12345678901234567890').toString('base64');
      const quote = createValidQuote(nonce);

      mockPCRService.verifyAttestation.mockResolvedValue({
        isValid: false,
        deviations: ['pcr0', 'pcr4'],
        riskScore: 0.8,
        recommendation: 'REJECT',
      });

      const result = await service.verifyAttestation(quote, nonce);

      expect(result.isValid).toBe(false);
      expect(result.reason).toContain('PCR verification failed');
      expect(result.reason).toContain('critical deviations');
      expect(result.pcrVerification?.recommendation).toBe('REJECT');
    });

    it('should require review for non-critical PCR deviations', async () => {
      const nonce = Buffer.from('test-nonce-12345678901234567890').toString('base64');
      const quote = createValidQuote(nonce);

      mockPCRService.verifyAttestation.mockResolvedValue({
        isValid: false,
        deviations: ['pcr9'],
        riskScore: 0.3,
        recommendation: 'REVIEW',
      });

      const result = await service.verifyAttestation(quote, nonce);

      expect(result.isValid).toBe(false);
      expect(result.reason).toContain('requires review');
      expect(result.pcrVerification?.recommendation).toBe('REVIEW');
    });
  });

  describe('Nonce Management', () => {
    it('should allow different nonces', async () => {
      const nonce1 = Buffer.from('test-nonce-1-1234567890123456789').toString('base64');
      const nonce2 = Buffer.from('test-nonce-2-1234567890123456789').toString('base64');

      const quote1 = createValidQuote(nonce1);
      const quote2 = createValidQuote(nonce2);

      mockPCRService.verifyAttestation.mockResolvedValue({
        isValid: true,
        deviations: [],
        riskScore: 0,
        recommendation: 'ACCEPT',
      });

      const result1 = await service.verifyAttestation(quote1, nonce1);
      const result2 = await service.verifyAttestation(quote2, nonce2);

      expect(result1.isValid).toBe(true);
      expect(result2.isValid).toBe(true);
    });

    it('should automatically clean up old nonces', async () => {
      jest.useFakeTimers();

      const nonce = Buffer.from('test-nonce-12345678901234567890').toString('base64');
      const quote = createValidQuote(nonce);

      mockPCRService.verifyAttestation.mockResolvedValue({
        isValid: true,
        deviations: [],
        riskScore: 0,
        recommendation: 'ACCEPT',
      });

      // First attestation
      const result1 = await service.verifyAttestation(quote, nonce);
      expect(result1.isValid).toBe(true);

      // Advance time by 6 minutes (beyond 5-minute TTL)
      jest.advanceTimersByTime(6 * 60 * 1000);

      // Nonce should be cleaned up, allowing reuse
      const result2 = await service.verifyAttestation(quote, nonce);
      expect(result2.isValid).toBe(true);

      jest.useRealTimers();
    });
  });

  describe('Baseline Registration', () => {
    it('should register trusted baseline', async () => {
      mockPCRService.registerBaseline.mockResolvedValue({
        profileId: 'test-profile',
        profile: sampleHardwareProfile,
        pcrValues: samplePCRValues,
        createdAt: new Date(),
        updatedAt: new Date(),
        trustScore: 0.8,
        nodeCount: 1,
      });

      await service.registerTrustedBaseline(sampleHardwareProfile, samplePCRValues);

      expect(mockPCRService.registerBaseline).toHaveBeenCalledWith(
        sampleHardwareProfile,
        samplePCRValues,
        true
      );
    });

    it('should register untrusted baseline', async () => {
      mockPCRService.registerBaseline.mockResolvedValue({
        profileId: 'test-profile',
        profile: sampleHardwareProfile,
        pcrValues: samplePCRValues,
        createdAt: new Date(),
        updatedAt: new Date(),
        trustScore: 0.3,
        nodeCount: 1,
      });

      await service.registerUntrustedBaseline(sampleHardwareProfile, samplePCRValues);

      expect(mockPCRService.registerBaseline).toHaveBeenCalledWith(
        sampleHardwareProfile,
        samplePCRValues,
        false
      );
    });
  });

  describe('Statistics', () => {
    it('should return baseline statistics', async () => {
      const mockStats = {
        totalBaselines: 10,
        totalNodes: 50,
        averageTrustScore: 0.75,
        topProfiles: [
          { profileId: 'profile1', nodeCount: 20, trustScore: 0.9 },
          { profileId: 'profile2', nodeCount: 15, trustScore: 0.8 },
        ],
      };

      mockPCRService.getStatistics.mockResolvedValue(mockStats);

      const stats = await service.getBaselineStatistics();

      expect(stats).toEqual(mockStats);
    });
  });

  describe('Edge Cases', () => {
    it('should handle malformed public key', async () => {
      const nonce = Buffer.from('test-nonce-12345678901234567890').toString('base64');
      const quote = createValidQuote(nonce);

      // Set malformed public key
      quote.publicKey = 'not-a-valid-base64-key';

      const result = await service.verifyAttestation(quote, nonce);

      expect(result.isValid).toBe(false);
      expect(result.signatureVerification?.passed).toBe(false);
    });

    it('should handle empty PCR values', async () => {
      const nonce = Buffer.from('test-nonce-12345678901234567890').toString('base64');
      const quote = createValidQuote(nonce);

      // Empty PCR values
      quote.pcrValues = {} as any;

      mockPCRService.verifyAttestation.mockResolvedValue({
        isValid: false,
        deviations: ['NO_BASELINE_FOUND'],
        riskScore: 1.0,
        recommendation: 'REJECT',
      });

      const result = await service.verifyAttestation(quote, nonce);

      expect(result.isValid).toBe(false);
    });

    it('should handle GPU hardware ID in attestation', async () => {
      const nonce = Buffer.from('test-nonce-12345678901234567890').toString('base64');
      const quote = createValidQuote(nonce);

      // Add GPU hardware ID
      quote.gpuHardwareId = createHash('sha256')
        .update('GPU-12345')
        .digest('hex');

      mockPCRService.verifyAttestation.mockResolvedValue({
        isValid: true,
        deviations: [],
        riskScore: 0,
        recommendation: 'ACCEPT',
      });

      const result = await service.verifyAttestation(quote, nonce);

      expect(result.isValid).toBe(true);
    });
  });
});
