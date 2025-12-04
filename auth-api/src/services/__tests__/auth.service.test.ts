import { FastifyInstance } from 'fastify';
import { AuthService, initializeAuthService } from '../auth.service';
import { getDatabaseService } from '../database.service';
import { attestationService } from '../attestation.service';
import { NodeStatus } from '../../models/types';
import jwt from '@fastify/jwt';
import Fastify from 'fastify';

// Mocks
jest.mock('../database.service');
jest.mock('../attestation.service');

describe('AuthService', () => {
  let fastify: FastifyInstance;
  let authService: AuthService;

  beforeAll(async () => {
    fastify = Fastify();
    await fastify.register(jwt, { secret: 'test-secret' });
    initializeAuthService(fastify);
    authService = new AuthService(fastify);
  });

  it('should generate a valid JWT', () => {
    const nodeId = 'test-node';
    const token = authService['generateJWT'](nodeId);
    const decoded = fastify.jwt.verify(token);
    expect(decoded.nodeId).toBe(nodeId);
  });

  it('should verify a valid JWT in heartbeat', async () => {
    const nodeId = 'test-node';
    const token = authService['generateJWT'](nodeId);

    (getDatabaseService as jest.Mock).mockReturnValue({
      getNodeIdentity: jest.fn().mockResolvedValue({ status: NodeStatus.ACTIVE }),
      updateNodeLastSeen: jest.fn().mockResolvedValue(undefined),
    });

    await expect(authService.processHeartbeat(nodeId, token)).resolves.not.toThrow();
  });

  it('should reject an invalid JWT in heartbeat', async () => {
    const nodeId = 'test-node';
    const invalidToken = 'invalid-token';

    await expect(authService.processHeartbeat(nodeId, invalidToken)).rejects.toThrow('Invalid JWT');
  });
});
