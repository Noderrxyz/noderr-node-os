/**
 * Authentication Service - Node Registration and Verification
 */

import { randomBytes } from 'crypto';
import { hash, compare } from 'bcryptjs';
import { randomUUID } from 'crypto';
import { getDatabaseService } from './database.service';
import { attestationService } from './attestation.service';
import {
  InstallConfigResponse,
  RegisterNodeRequest,
  RegisterNodeResponse,
  NodeStatus,
} from '../models/types';
import { FastifyInstance } from 'fastify';
import '@fastify/jwt';

const SALT_ROUNDS = 14; // Increased salt rounds
const API_KEY_PREFIX = 'ndr_live_';
const CREDENTIAL_EXPIRY_DAYS = 365;

export class AuthService {
  private fastify: FastifyInstance;

  constructor(fastify: FastifyInstance) {
    this.fastify = fastify;
  }

  /**
   * Get installation configuration using install token
   */
  async getInstallConfig(installToken: string): Promise<InstallConfigResponse> {
    const db = getDatabaseService();

    // Get token from database
    const token = await db.getInstallToken(installToken);

    if (!token) {
      throw new Error('Invalid installation token');
    }

    // Check if token is expired
    if (new Date() > token.expiresAt) {
      throw new Error('Installation token has expired');
    }

    // Check if token is already used
    if (token.isUsed) {
      throw new Error('Installation token has already been used');
    }

    // Generate temporary node ID
    const tempNodeId = `temp-${randomUUID().replace(/-/g, '').substring(0, 16)}`;

    return {
      nodeId: tempNodeId,
      tier: token.tier,
      os: token.os,
      config: {
        deploymentEngineUrl: process.env.DEPLOYMENT_ENGINE_URL || 'https://deploy.noderr.xyz',
        authApiUrl: process.env.AUTH_API_URL || 'https://auth.noderr.xyz',
        dockerRegistry: process.env.DOCKER_REGISTRY || 'ghcr.io/noderrxyz',
        telemetryEndpoint: process.env.TELEMETRY_ENDPOINT || 'https://telemetry.noderr.xyz',
      },
    };
  }

  /**
   * Register a new node with TPM-attested public key
   */
  async registerNode(request: RegisterNodeRequest): Promise<RegisterNodeResponse> {
    const db = getDatabaseService();

    // Validate install token
    const token = await db.getInstallToken(request.installToken);

    if (!token) {
      throw new Error('Invalid installation token');
    }

    if (new Date() > token.expiresAt) {
      throw new Error('Installation token has expired');
    }

    if (token.isUsed) {
      throw new Error('Installation token has already been used');
    }

    // Validate public key format
    if (!attestationService.validatePublicKey(request.publicKey)) {
      throw new Error('Invalid public key format');
    }

    // Verify TPM attestation
    const isAttestationValid = attestationService.verifyAttestation(
      request.publicKey,
      request.attestation
    );

    if (!isAttestationValid) {
      throw new Error('TPM attestation verification failed');
    }

    // Verify secure boot (optional but recommended)
    const isSecureBoot = attestationService.verifySecureBoot(request.attestation.pcrValues);
    if (!isSecureBoot) {
      console.warn('Secure boot verification failed - proceeding anyway');
    }

    // Generate node ID from public key
    const nodeId = attestationService.generateNodeId(request.publicKey);

    // Check if node already exists
    const existingNode = await db.getNodeIdentity(nodeId);
    if (existingNode) {
      throw new Error('Node with this public key is already registered');
    }

    // Create node identity
    await db.createNodeIdentity({
      nodeId,
      publicKey: request.publicKey,
      attestationData: request.attestation,
      tier: token.tier,
      os: token.os,
      installTokenId: token.id,
      status: NodeStatus.ACTIVE,
      lastSeen: new Date(),
    });

    // Mark token as used
    await db.markTokenAsUsed(token.id);

    // Generate API key
    const apiKey = this.generateApiKey();
    const apiKeyHash = await hash(apiKey, SALT_ROUNDS);

    // Create credentials
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + CREDENTIAL_EXPIRY_DAYS);

    const jwtSecret = randomBytes(32).toString('hex');

    await db.createNodeCredentials({
      nodeId,
      apiKeyHash,
      jwtSecret,
      expiresAt,
    });

    // Generate JWT token
    const jwtToken = this.generateJWT(nodeId);

    return {
      nodeId,
      apiKey,
      jwtToken,
      status: 'registered',
    };
  }

  /**
   * Verify node credentials and issue new JWT
   */
  async verifyNode(nodeId: string, apiKey: string, challenge: string): Promise<string> {
    const db = getDatabaseService();

    // Get node identity
    const node = await db.getNodeIdentity(nodeId);

    if (!node) {
      throw new Error('Node not found');
    }

    if (node.status !== NodeStatus.ACTIVE) {
      throw new Error(`Node status is ${node.status}`);
    }

    // Get credentials
    const credentials = await db.getNodeCredentials(nodeId);

    if (!credentials) {
      throw new Error('Node credentials not found');
    }

    // Check if credentials are expired
    if (new Date() > credentials.expiresAt) {
      throw new Error('Node credentials have expired');
    }

    // Verify API key
    const isApiKeyValid = await compare(apiKey, credentials.apiKeyHash);

    if (!isApiKeyValid) {
      throw new Error('Invalid API key');
    }

    // Update last seen
    await db.updateNodeLastSeen(nodeId);

    // Generate new JWT
    return this.generateJWT(nodeId);
  }

  /**
   * Process node heartbeat
   */
  async processHeartbeat(nodeId: string, jwtToken: string, metrics?: {
    uptime: number;
    cpu: number;
    memory: number;
    disk?: number;
    network?: { rx: number; tx: number };
    version: string;
  }): Promise<void> {
    const db = getDatabaseService();

    // Verify JWT
    try {
      await (this.fastify as any).jwt.verify(jwtToken);
    } catch (err) {
      throw new Error('Invalid JWT');
    }

    const node = await db.getNodeIdentity(nodeId);

    if (!node) {
      throw new Error('Node not found');
    }

    if (node.status !== NodeStatus.ACTIVE) {
      throw new Error(`Node status is ${node.status}`);
    }

    // Update last seen
    await db.updateNodeLastSeen(nodeId);

    // Store metrics if provided
    if (metrics) {
      await db.storeNodeMetrics(nodeId, metrics);
    }
  }

  /**
   * Generate API key
   */
  private generateApiKey(): string {
    const keyBytes = randomBytes(32);
    return `${API_KEY_PREFIX}${keyBytes.toString('hex')}`;
  }

  /**
   * Generate JWT token
   */
  private generateJWT(nodeId: string): string {
    return (this.fastify as any).jwt.sign({ nodeId });
  }
}

export let authService: AuthService;

export function initializeAuthService(fastify: FastifyInstance) {
  authService = new AuthService(fastify);
}
