/**
 * Authentication Service Tests
 */

import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import { authService, initializeAuthService } from '../src/services/auth.service';
import { attestationService } from '../src/services/attestation.service';
import { getDatabaseService, initializeDatabaseService } from '../src/services/database.service';
import { NodeTier, OperatingSystem, NodeStatus } from '../src/models/types';

// Mock Supabase
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    from: jest.fn(() => ({
      select: jest.fn().mockReturnThis(),
      insert: jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnThis(),
      delete: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: null, error: null }),
    })),
  })),
}));

describe('AuthService', () => {
    beforeAll(async () => {
    // Initialize database service with mock
        initializeDatabaseService('https://test.supabase.co', 'test-key');
    const fastify = Fastify();
    await fastify.register(jwt, { secret: 'test-secret' });
    initializeAuthService(fastify);
  });

  describe('getInstallConfig', () => {
    it('should return install configuration for valid token', async () => {
      const mockToken = {
        id: 'test-id',
        token: 'ndr_install_test123',
        applicationId: 'app-123',
        tier: NodeTier.ORACLE,
        os: OperatingSystem.LINUX,
        isUsed: false,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      };

      // Mock database response
      jest.spyOn(getDatabaseService(), 'getInstallToken').mockResolvedValue(mockToken);

      const config = await authService.getInstallConfig('ndr_install_test123');

      expect(config).toHaveProperty('nodeId');
      expect(config).toHaveProperty('tier', NodeTier.ORACLE);
      expect(config).toHaveProperty('os', OperatingSystem.LINUX);
      expect(config).toHaveProperty('config');
      expect(config.config).toHaveProperty('deploymentEngineUrl');
      expect(config.config).toHaveProperty('authApiUrl');
    });

    it('should throw error for invalid token', async () => {
      jest.spyOn(getDatabaseService(), 'getInstallToken').mockResolvedValue(null);

      await expect(authService.getInstallConfig('invalid-token')).rejects.toThrow(
        'Invalid installation token'
      );
    });

    it('should throw error for expired token', async () => {
      const expiredToken = {
        id: 'test-id',
        token: 'ndr_install_expired',
        applicationId: 'app-123',
        tier: NodeTier.ALL,
        os: OperatingSystem.LINUX,
        isUsed: false,
        createdAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
        expiresAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000), // Expired yesterday
      };

      jest.spyOn(getDatabaseService(), 'getInstallToken').mockResolvedValue(expiredToken);

      await expect(authService.getInstallConfig('ndr_install_expired')).rejects.toThrow(
        'Installation token has expired'
      );
    });

    it('should throw error for already used token', async () => {
      const usedToken = {
        id: 'test-id',
        token: 'ndr_install_used',
        applicationId: 'app-123',
        tier: NodeTier.ALL,
        os: OperatingSystem.LINUX,
        isUsed: true,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      };

      jest.spyOn(getDatabaseService(), 'getInstallToken').mockResolvedValue(usedToken);

      await expect(authService.getInstallConfig('ndr_install_used')).rejects.toThrow(
        'Installation token has already been used'
      );
    });
  });

  describe('registerNode', () => {
    const mockPublicKey = `-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE...
-----END PUBLIC KEY-----`;

    const mockAttestation = {
      quote: Buffer.from('test-quote').toString('base64'),
      signature: Buffer.from('test-signature').toString('base64'),
      pcrValues: {
        '0': 'a'.repeat(64),
        '7': 'b'.repeat(64),
      },
      timestamp: new Date().toISOString(),
    };

    const mockSystemInfo = {
      hostname: 'test-node',
      cpuCores: 8,
      memoryGB: 16,
      diskGB: 500,
    };

    it('should register node with valid attestation', async () => {
      const mockToken = {
        id: 'test-id',
        token: 'ndr_install_test123',
        applicationId: 'app-123',
        tier: NodeTier.ORACLE,
        os: OperatingSystem.LINUX,
        isUsed: false,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      };

      jest.spyOn(getDatabaseService(), 'getInstallToken').mockResolvedValue(mockToken);
      jest.spyOn(attestationService, 'validatePublicKey').mockReturnValue(true);
      jest.spyOn(attestationService, 'verifyAttestation').mockReturnValue(true);
      jest.spyOn(attestationService, 'generateNodeId').mockReturnValue('0xtest123');
      jest.spyOn(getDatabaseService(), 'getNodeIdentity').mockResolvedValue(null);
      jest.spyOn(getDatabaseService(), 'createNodeIdentity').mockResolvedValue({} as any);
      jest.spyOn(getDatabaseService(), 'markTokenAsUsed').mockResolvedValue();
      jest.spyOn(getDatabaseService(), 'createNodeCredentials').mockResolvedValue({} as any);

      const result = await authService.registerNode({
        installToken: 'ndr_install_test123',
        publicKey: mockPublicKey,
        attestation: mockAttestation,
        systemInfo: mockSystemInfo,
      });

      expect(result).toHaveProperty('nodeId');
      expect(result).toHaveProperty('apiKey');
      expect(result).toHaveProperty('jwtToken');
      expect(result).toHaveProperty('status', 'registered');
      expect(result.apiKey).toMatch(/^ndr_live_/);
    });

    it('should reject invalid public key', async () => {
      const mockToken = {
        id: 'test-id',
        token: 'ndr_install_test123',
        applicationId: 'app-123',
        tier: NodeTier.ALL,
        os: OperatingSystem.LINUX,
        isUsed: false,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      };

      jest.spyOn(getDatabaseService(), 'getInstallToken').mockResolvedValue(mockToken);
      jest.spyOn(attestationService, 'validatePublicKey').mockReturnValue(false);

      await expect(
        authService.registerNode({
          installToken: 'ndr_install_test123',
          publicKey: 'invalid-key',
          attestation: mockAttestation,
          systemInfo: mockSystemInfo,
        })
      ).rejects.toThrow('Invalid public key format');
    });

    it('should reject invalid attestation', async () => {
      const mockToken = {
        id: 'test-id',
        token: 'ndr_install_test123',
        applicationId: 'app-123',
        tier: NodeTier.ALL,
        os: OperatingSystem.LINUX,
        isUsed: false,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      };

      jest.spyOn(getDatabaseService(), 'getInstallToken').mockResolvedValue(mockToken);
      jest.spyOn(attestationService, 'validatePublicKey').mockReturnValue(true);
      jest.spyOn(attestationService, 'verifyAttestation').mockReturnValue(false);

      await expect(
        authService.registerNode({
          installToken: 'ndr_install_test123',
          publicKey: mockPublicKey,
          attestation: mockAttestation,
          systemInfo: mockSystemInfo,
        })
      ).rejects.toThrow('TPM attestation verification failed');
    });

    it('should reject duplicate node registration', async () => {
      const mockToken = {
        id: 'test-id',
        token: 'ndr_install_test123',
        applicationId: 'app-123',
        tier: NodeTier.ALL,
        os: OperatingSystem.LINUX,
        isUsed: false,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      };

      const existingNode = {
        id: 'existing-id',
        nodeId: '0xtest123',
        publicKey: mockPublicKey,
        attestationData: mockAttestation,
        tier: NodeTier.ALL,
        os: OperatingSystem.LINUX,
        installTokenId: 'test-id',
        status: NodeStatus.ACTIVE,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      jest.spyOn(getDatabaseService(), 'getInstallToken').mockResolvedValue(mockToken);
      jest.spyOn(attestationService, 'validatePublicKey').mockReturnValue(true);
      jest.spyOn(attestationService, 'verifyAttestation').mockReturnValue(true);
      jest.spyOn(attestationService, 'generateNodeId').mockReturnValue('0xtest123');
      jest.spyOn(getDatabaseService(), 'getNodeIdentity').mockResolvedValue(existingNode);

      await expect(
        authService.registerNode({
          installToken: 'ndr_install_test123',
          publicKey: mockPublicKey,
          attestation: mockAttestation,
          systemInfo: mockSystemInfo,
        })
      ).rejects.toThrow('Node with this public key is already registered');
    });
  });

  describe('verifyNode', () => {
    it('should verify node with valid credentials', async () => {
      const mockNode = {
        id: 'node-id',
        nodeId: '0xtest123',
        publicKey: 'test-key',
        attestationData: {} as any,
        tier: NodeTier.ALL,
        os: OperatingSystem.LINUX,
        installTokenId: 'token-id',
        status: NodeStatus.ACTIVE,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockCredentials = {
        id: 'cred-id',
        nodeId: '0xtest123',
        apiKeyHash: '$2b$12$test', // Mock bcrypt hash
        jwtSecret: 'test-secret',
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      };

      jest.spyOn(getDatabaseService(), 'getNodeIdentity').mockResolvedValue(mockNode);
      jest.spyOn(getDatabaseService(), 'getNodeCredentials').mockResolvedValue(mockCredentials);
      jest.spyOn(getDatabaseService(), 'updateNodeLastSeen').mockResolvedValue();

      // Mock bcryptjs compare
      const bcryptjs = require('bcryptjs');
      jest.spyOn(bcryptjs, 'compare').mockResolvedValue(true);

      const jwtToken = await authService.verifyNode('0xtest123', 'test-api-key', 'challenge');

      expect(jwtToken).toBeTruthy();
      expect(typeof jwtToken).toBe('string');
    });

    it('should reject invalid API key', async () => {
      const mockNode = {
        id: 'node-id',
        nodeId: '0xtest123',
        publicKey: 'test-key',
        attestationData: {} as any,
        tier: NodeTier.ALL,
        os: OperatingSystem.LINUX,
        installTokenId: 'token-id',
        status: NodeStatus.ACTIVE,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockCredentials = {
        id: 'cred-id',
        nodeId: '0xtest123',
        apiKeyHash: '$2b$12$test',
        jwtSecret: 'test-secret',
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      };

      jest.spyOn(getDatabaseService(), 'getNodeIdentity').mockResolvedValue(mockNode);
      jest.spyOn(getDatabaseService(), 'getNodeCredentials').mockResolvedValue(mockCredentials);

      // Mock bcrypt compare to return false
      const bcrypt = require("bcryptjs");
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(false);

      await expect(
        authService.verifyNode('0xtest123', 'wrong-api-key', 'challenge')
      ).rejects.toThrow('Invalid API key');
    });

    it('should reject suspended node', async () => {
      const suspendedNode = {
        id: 'node-id',
        nodeId: '0xtest123',
        publicKey: 'test-key',
        attestationData: {} as any,
        tier: NodeTier.ALL,
        os: OperatingSystem.LINUX,
        installTokenId: 'token-id',
        status: NodeStatus.SUSPENDED,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      jest.spyOn(getDatabaseService(), 'getNodeIdentity').mockResolvedValue(suspendedNode);

      await expect(
        authService.verifyNode('0xtest123', 'test-api-key', 'challenge')
      ).rejects.toThrow('Node status is suspended');
    });
  });
});
