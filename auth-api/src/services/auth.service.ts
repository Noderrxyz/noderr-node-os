/**
 * Authentication Service - Node Registration and Verification
 */

import { randomBytes } from 'crypto';
import { hash, compare } from 'bcrypt';
import { nanoid } from 'nanoid';
import { getDatabaseService } from './database.service';
import { attestationService } from './attestation.service';
import {
  InstallConfigResponse,
  RegisterNodeRequest,
  RegisterNodeResponse,
  NodeStatus,
  NodeTier,
  OperatingSystem,
} from '../models/types';

const SALT_ROUNDS = 12;
const API_KEY_PREFIX = 'ndr_live_';
const JWT_SECRET_LENGTH = 64;
const CREDENTIAL_EXPIRY_DAYS = 365;

export class AuthService {
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
    const tempNodeId = `temp-${nanoid(16)}`;

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

    // Generate JWT secret
    const jwtSecret = randomBytes(JWT_SECRET_LENGTH).toString('hex');

    // Create credentials
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + CREDENTIAL_EXPIRY_DAYS);

    await db.createNodeCredentials({
      nodeId,
      apiKeyHash,
      jwtSecret,
      expiresAt,
    });

    // Generate JWT token
    const jwtToken = this.generateJWT(nodeId, jwtSecret);

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
    return this.generateJWT(nodeId, credentials.jwtSecret);
  }

  /**
   * Process node heartbeat
   */
  async processHeartbeat(nodeId: string, jwtToken: string): Promise<void> {
    const db = getDatabaseService();

    // Verify JWT (simplified - in production use proper JWT verification)
    // For now, just check if node exists and is active

    const node = await db.getNodeIdentity(nodeId);

    if (!node) {
      throw new Error('Node not found');
    }

    if (node.status !== NodeStatus.ACTIVE) {
      throw new Error(`Node status is ${node.status}`);
    }

    // Update last seen
    await db.updateNodeLastSeen(nodeId);
  }

  /**
   * Generate API key
   */
  private generateApiKey(): string {
    const keyBytes = randomBytes(32);
    return `${API_KEY_PREFIX}${keyBytes.toString('hex')}`;
  }

  /**
   * Generate JWT token (simplified)
   * In production, use @fastify/jwt
   */
  private generateJWT(nodeId: string, secret: string): string {
    // Simplified JWT generation
    // In production, use proper JWT library with signing
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({
        nodeId,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 86400, // 24 hours
      })
    ).toString('base64url');

    // In production, sign with secret
    const signature = Buffer.from(secret).toString('base64url').substring(0, 43);

    return `${header}.${payload}.${signature}`;
  }
}

export const authService = new AuthService();
