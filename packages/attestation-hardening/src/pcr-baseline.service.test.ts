import { PCRBaselineService, HardwareProfile, PCRValues } from './pcr-baseline.service';
import { Redis } from 'ioredis';

// Mock Redis for testing
jest.mock('ioredis');

describe('PCRBaselineService', () => {
  let service: PCRBaselineService;
  let mockRedis: jest.Mocked<Redis>;

  const sampleProfile: HardwareProfile = {
    cpuModel: 'Intel Core i7-12700K',
    biosVendor: 'American Megatrends',
    biosVersion: '2.14',
    osName: 'Ubuntu',
    osVersion: '22.04',
    kernelVersion: '5.15.0-76-generic',
    tpmVersion: '2.0',
  };

  const samplePCRValues: PCRValues = {
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

  beforeEach(() => {
    mockRedis = {
      get: jest.fn(),
      set: jest.fn(),
      expire: jest.fn(),
      del: jest.fn(),
      sadd: jest.fn(),
      smembers: jest.fn(),
      keys: jest.fn(),
      quit: jest.fn(),
    } as any;

    (Redis as jest.MockedClass<typeof Redis>).mockImplementation(() => mockRedis);

    service = new PCRBaselineService('redis://localhost:6379');
  });

  afterEach(async () => {
    await service.close();
  });

  describe('registerBaseline', () => {
    it('should register a new baseline for first-time hardware profile', async () => {
      mockRedis.get.mockResolvedValue(null);
      mockRedis.set.mockResolvedValue('OK');
      mockRedis.expire.mockResolvedValue(1);
      mockRedis.sadd.mockResolvedValue(1);

      const baseline = await service.registerBaseline(sampleProfile, samplePCRValues, true);

      expect(baseline.profile).toEqual(sampleProfile);
      expect(baseline.pcrValues).toEqual(samplePCRValues);
      expect(baseline.trustScore).toBe(0.8); // Trusted node
      expect(baseline.nodeCount).toBe(1);
      expect(mockRedis.set).toHaveBeenCalled();
      expect(mockRedis.expire).toHaveBeenCalledWith(expect.any(String), 90 * 24 * 60 * 60);
    });

    it('should increment node count for existing baseline', async () => {
      const existingBaseline = {
        profileId: 'test-profile',
        profile: sampleProfile,
        pcrValues: samplePCRValues,
        createdAt: new Date(),
        updatedAt: new Date(),
        trustScore: 0.5,
        nodeCount: 5,
      };

      mockRedis.get.mockResolvedValue(JSON.stringify(existingBaseline));
      mockRedis.set.mockResolvedValue('OK');
      mockRedis.expire.mockResolvedValue(1);

      const baseline = await service.registerBaseline(sampleProfile, samplePCRValues, false);

      expect(baseline.nodeCount).toBe(6);
      expect(baseline.trustScore).toBe(0.5); // Untrusted node doesn't increase trust
    });

    it('should increase trust score when trusted node registers with existing baseline', async () => {
      const existingBaseline = {
        profileId: 'test-profile',
        profile: sampleProfile,
        pcrValues: samplePCRValues,
        createdAt: new Date(),
        updatedAt: new Date(),
        trustScore: 0.5,
        nodeCount: 5,
      };

      mockRedis.get.mockResolvedValue(JSON.stringify(existingBaseline));
      mockRedis.set.mockResolvedValue('OK');
      mockRedis.expire.mockResolvedValue(1);

      const baseline = await service.registerBaseline(sampleProfile, samplePCRValues, true);

      expect(baseline.trustScore).toBe(0.6); // 0.5 + 0.1
    });

    it('should cap trust score at 1.0', async () => {
      const existingBaseline = {
        profileId: 'test-profile',
        profile: sampleProfile,
        pcrValues: samplePCRValues,
        createdAt: new Date(),
        updatedAt: new Date(),
        trustScore: 0.95,
        nodeCount: 10,
      };

      mockRedis.get.mockResolvedValue(JSON.stringify(existingBaseline));
      mockRedis.set.mockResolvedValue('OK');
      mockRedis.expire.mockResolvedValue(1);

      const baseline = await service.registerBaseline(sampleProfile, samplePCRValues, true);

      expect(baseline.trustScore).toBe(1.0); // Capped at 1.0
    });
  });

  describe('verifyAttestation', () => {
    it('should accept attestation with matching PCR values', async () => {
      const baseline = {
        profileId: 'test-profile',
        profile: sampleProfile,
        pcrValues: samplePCRValues,
        createdAt: new Date(),
        updatedAt: new Date(),
        trustScore: 0.9,
        nodeCount: 10,
      };

      mockRedis.get.mockResolvedValue(JSON.stringify(baseline));

      const result = await service.verifyAttestation(sampleProfile, samplePCRValues);

      expect(result.isValid).toBe(true);
      expect(result.recommendation).toBe('ACCEPT');
      expect(result.deviations).toHaveLength(0);
      expect(result.riskScore).toBe(0);
    });

    it('should reject attestation with critical PCR deviations', async () => {
      const baseline = {
        profileId: 'test-profile',
        profile: sampleProfile,
        pcrValues: samplePCRValues,
        createdAt: new Date(),
        updatedAt: new Date(),
        trustScore: 0.9,
        nodeCount: 10,
      };

      mockRedis.get.mockResolvedValue(JSON.stringify(baseline));

      // Modify critical PCR (pcr0)
      const modifiedPCRValues = { ...samplePCRValues, pcr0: 'x'.repeat(64) };

      const result = await service.verifyAttestation(sampleProfile, modifiedPCRValues);

      expect(result.isValid).toBe(false);
      expect(result.recommendation).toBe('REJECT');
      expect(result.deviations).toContain('pcr0');
      expect(result.riskScore).toBeGreaterThan(0);
    });

    it('should require review for non-critical PCR deviations', async () => {
      const baseline = {
        profileId: 'test-profile',
        profile: sampleProfile,
        pcrValues: samplePCRValues,
        createdAt: new Date(),
        updatedAt: new Date(),
        trustScore: 0.9,
        nodeCount: 10,
      };

      mockRedis.get.mockResolvedValue(JSON.stringify(baseline));

      // Modify non-critical PCR (pcr9)
      const modifiedPCRValues = { ...samplePCRValues, pcr9: 'x'.repeat(64) };

      const result = await service.verifyAttestation(sampleProfile, modifiedPCRValues);

      expect(result.isValid).toBe(false);
      expect(result.deviations).toContain('pcr9');
    });

    it('should require review when no baseline exists', async () => {
      mockRedis.get.mockResolvedValue(null);

      const result = await service.verifyAttestation(sampleProfile, samplePCRValues);

      expect(result.isValid).toBe(false);
      expect(result.recommendation).toBe('REVIEW');
      expect(result.deviations).toContain('NO_BASELINE_FOUND');
      expect(result.riskScore).toBe(0.5); // Medium risk
    });

    it('should adjust risk score based on baseline trust score', async () => {
      const lowTrustBaseline = {
        profileId: 'test-profile',
        profile: sampleProfile,
        pcrValues: samplePCRValues,
        createdAt: new Date(),
        updatedAt: new Date(),
        trustScore: 0.3, // Low trust
        nodeCount: 2,
      };

      mockRedis.get.mockResolvedValue(JSON.stringify(lowTrustBaseline));

      // Modify non-critical PCR
      const modifiedPCRValues = { ...samplePCRValues, pcr9: 'x'.repeat(64) };

      const result = await service.verifyAttestation(sampleProfile, modifiedPCRValues);

      // Risk should be higher for low-trust baseline
      expect(result.riskScore).toBeGreaterThan(0);
    });
  });

  describe('getBaselinesForProfile', () => {
    it('should return all baselines for a hardware profile', async () => {
      const baseline1 = {
        profileId: 'test-profile',
        profile: sampleProfile,
        pcrValues: samplePCRValues,
        createdAt: new Date(),
        updatedAt: new Date(),
        trustScore: 0.9,
        nodeCount: 10,
      };

      const baseline2 = {
        profileId: 'test-profile',
        profile: sampleProfile,
        pcrValues: { ...samplePCRValues, pcr10: 'z'.repeat(64) },
        createdAt: new Date(),
        updatedAt: new Date(),
        trustScore: 0.7,
        nodeCount: 5,
      };

      mockRedis.smembers.mockResolvedValue(['key1', 'key2']);
      mockRedis.get
        .mockResolvedValueOnce(JSON.stringify(baseline1))
        .mockResolvedValueOnce(JSON.stringify(baseline2));

      const baselines = await service.getBaselinesForProfile(sampleProfile);

      expect(baselines).toHaveLength(2);
      expect(baselines[0].trustScore).toBe(0.9); // Sorted by trust score descending
      expect(baselines[1].trustScore).toBe(0.7);
    });

    it('should return empty array when no baselines exist', async () => {
      mockRedis.smembers.mockResolvedValue([]);

      const baselines = await service.getBaselinesForProfile(sampleProfile);

      expect(baselines).toHaveLength(0);
    });
  });

  describe('updateBaselineTrust', () => {
    it('should update trust score for existing baseline', async () => {
      const baseline = {
        profileId: 'test-profile',
        profile: sampleProfile,
        pcrValues: samplePCRValues,
        createdAt: new Date(),
        updatedAt: new Date(),
        trustScore: 0.5,
        nodeCount: 5,
      };

      mockRedis.get.mockResolvedValue(JSON.stringify(baseline));
      mockRedis.set.mockResolvedValue('OK');

      await service.updateBaselineTrust('test-profile', 0.8);

      expect(mockRedis.set).toHaveBeenCalled();
      const setCall = mockRedis.set.mock.calls[0];
      const updatedBaseline = JSON.parse(setCall[1] as string);
      expect(updatedBaseline.trustScore).toBe(0.8);
    });

    it('should throw error for invalid trust score', async () => {
      await expect(service.updateBaselineTrust('test-profile', 1.5)).rejects.toThrow(
        'Trust score must be between 0 and 1'
      );

      await expect(service.updateBaselineTrust('test-profile', -0.1)).rejects.toThrow(
        'Trust score must be between 0 and 1'
      );
    });

    it('should throw error for non-existent baseline', async () => {
      mockRedis.get.mockResolvedValue(null);

      await expect(service.updateBaselineTrust('non-existent', 0.8)).rejects.toThrow(
        'Baseline non-existent not found'
      );
    });
  });

  describe('removeBaseline', () => {
    it('should remove baseline and profile index', async () => {
      mockRedis.del.mockResolvedValue(1);

      await service.removeBaseline('test-profile');

      expect(mockRedis.del).toHaveBeenCalledTimes(2);
      expect(mockRedis.del).toHaveBeenCalledWith(expect.stringContaining('baseline'));
      expect(mockRedis.del).toHaveBeenCalledWith(expect.stringContaining('profile'));
    });
  });

  describe('getStatistics', () => {
    it('should return correct statistics', async () => {
      const baseline1 = {
        profileId: 'profile1',
        profile: sampleProfile,
        pcrValues: samplePCRValues,
        createdAt: new Date(),
        updatedAt: new Date(),
        trustScore: 0.9,
        nodeCount: 10,
      };

      const baseline2 = {
        profileId: 'profile2',
        profile: sampleProfile,
        pcrValues: samplePCRValues,
        createdAt: new Date(),
        updatedAt: new Date(),
        trustScore: 0.7,
        nodeCount: 5,
      };

      mockRedis.keys.mockResolvedValue(['key1', 'key2']);
      mockRedis.get
        .mockResolvedValueOnce(JSON.stringify(baseline1))
        .mockResolvedValueOnce(JSON.stringify(baseline2));

      const stats = await service.getStatistics();

      expect(stats.totalBaselines).toBe(2);
      expect(stats.totalNodes).toBe(15); // 10 + 5
      expect(stats.averageTrustScore).toBe(0.8); // (0.9 + 0.7) / 2
      expect(stats.topProfiles).toHaveLength(2);
      expect(stats.topProfiles[0].nodeCount).toBe(10); // Sorted by node count
    });

    it('should handle empty database', async () => {
      mockRedis.keys.mockResolvedValue([]);

      const stats = await service.getStatistics();

      expect(stats.totalBaselines).toBe(0);
      expect(stats.totalNodes).toBe(0);
      expect(stats.averageTrustScore).toBe(0);
      expect(stats.topProfiles).toHaveLength(0);
    });
  });

  describe('Profile ID Generation', () => {
    it('should generate same profile ID for identical hardware', async () => {
      mockRedis.get.mockResolvedValue(null);
      mockRedis.set.mockResolvedValue('OK');
      mockRedis.expire.mockResolvedValue(1);
      mockRedis.sadd.mockResolvedValue(1);

      const baseline1 = await service.registerBaseline(sampleProfile, samplePCRValues, true);
      const baseline2 = await service.registerBaseline(sampleProfile, samplePCRValues, true);

      expect(baseline1.profileId).toBe(baseline2.profileId);
    });

    it('should generate different profile IDs for different hardware', async () => {
      mockRedis.get.mockResolvedValue(null);
      mockRedis.set.mockResolvedValue('OK');
      mockRedis.expire.mockResolvedValue(1);
      mockRedis.sadd.mockResolvedValue(1);

      const profile2: HardwareProfile = {
        ...sampleProfile,
        cpuModel: 'AMD Ryzen 9 5950X',
      };

      const baseline1 = await service.registerBaseline(sampleProfile, samplePCRValues, true);
      const baseline2 = await service.registerBaseline(profile2, samplePCRValues, true);

      expect(baseline1.profileId).not.toBe(baseline2.profileId);
    });
  });
});
