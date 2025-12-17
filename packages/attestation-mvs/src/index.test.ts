import { AttestationService, AttestationQuote } from './index';
import { createSign, generateKeyPairSync } from 'crypto';
import Redis from 'ioredis-mock';

jest.mock('ioredis', () => require('ioredis-mock'));

describe('AttestationService', () => {
  let service: AttestationService;
  let keyPair: { publicKey: string; privateKey: string };

  beforeAll(() => {
    // Generate RSA key pair for testing
    const { publicKey, privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    keyPair = { publicKey, privateKey };
  });

  beforeEach(() => {
    service = new AttestationService('redis://localhost:6379');
  });

  afterEach(async () => {
    await service.close();
  });

  function createValidQuote(nonce: string): AttestationQuote {
    const signedData = JSON.stringify({
      nonce,
      timestamp: Math.floor(Date.now() / 1000),
      nodeId: 'test-node',
    });

    const signer = createSign('RSA-SHA256');
    signer.update(Buffer.from(signedData));
    const signature = signer.sign(keyPair.privateKey);

    return {
      signedData,
      signature: signature.toString('base64'),
      publicKey: Buffer.from(keyPair.publicKey).toString('base64'),
      nonce,
      timestamp: Math.floor(Date.now() / 1000),
    };
  }

  describe('verifyAttestation', () => {
    it('should accept valid attestation', async () => {
      const nonce = service.generateNonce();
      const quote = createValidQuote(nonce);

      const result = await service.verifyAttestation(quote, nonce);

      expect(result.valid).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('should reject invalid signature', async () => {
      const nonce = service.generateNonce();
      const quote = createValidQuote(nonce);
      quote.signature = Buffer.from('invalid-signature').toString('base64');

      const result = await service.verifyAttestation(quote, nonce);

      expect(result.valid).toBe(false);
      expect(result.reason).toBe('Invalid TPM signature');
    });

    it('should reject nonce mismatch', async () => {
      const nonce = service.generateNonce();
      const wrongNonce = service.generateNonce();
      const quote = createValidQuote(wrongNonce);

      const result = await service.verifyAttestation(quote, nonce);

      expect(result.valid).toBe(false);
      expect(result.reason).toBe('Nonce mismatch');
    });

    it('should reject replay attack (nonce reuse)', async () => {
      const nonce = service.generateNonce();
      const quote1 = createValidQuote(nonce);
      const quote2 = createValidQuote(nonce);

      const result1 = await service.verifyAttestation(quote1, nonce);
      expect(result1.valid).toBe(true);

      const result2 = await service.verifyAttestation(quote2, nonce);
      expect(result2.valid).toBe(false);
      expect(result2.reason).toBe('Nonce already used (replay attack)');
    });

    it('should reject old attestation', async () => {
      const nonce = service.generateNonce();
      const quote = createValidQuote(nonce);
      quote.timestamp = Math.floor(Date.now() / 1000) - 120; // 2 minutes old

      const result = await service.verifyAttestation(quote, nonce);

      expect(result.valid).toBe(false);
      expect(result.reason).toBe('Attestation too old');
    });

    it('should reject future timestamp', async () => {
      const nonce = service.generateNonce();
      const quote = createValidQuote(nonce);
      quote.timestamp = Math.floor(Date.now() / 1000) + 120; // 2 minutes in future

      const result = await service.verifyAttestation(quote, nonce);

      expect(result.valid).toBe(false);
      expect(result.reason).toBe('Attestation timestamp in future');
    });

    it('should accept attestation within time window', async () => {
      const nonce = service.generateNonce();
      const quote = createValidQuote(nonce);
      quote.timestamp = Math.floor(Date.now() / 1000) - 30; // 30 seconds old

      const result = await service.verifyAttestation(quote, nonce);

      expect(result.valid).toBe(true);
    });
  });

  describe('generateNonce', () => {
    it('should generate 64-character hex nonce', () => {
      const nonce = service.generateNonce();

      expect(nonce).toHaveLength(64);
      expect(nonce).toMatch(/^[0-9a-f]{64}$/);
    });

    it('should generate unique nonces', () => {
      const nonce1 = service.generateNonce();
      const nonce2 = service.generateNonce();

      expect(nonce1).not.toBe(nonce2);
    });

    it('should generate cryptographically random nonces', () => {
      const nonces = new Set();
      for (let i = 0; i < 100; i++) {
        nonces.add(service.generateNonce());
      }

      expect(nonces.size).toBe(100); // All unique
    });
  });
});
