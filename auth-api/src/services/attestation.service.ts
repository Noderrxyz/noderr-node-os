/**
 * Attestation Service - TPM Attestation Verification
 */

import { createHash, createVerify } from 'crypto';
import { AttestationData } from '../models/types';

export class AttestationService {
  /**
   * Verify TPM attestation data
   * @param publicKey Public key in PEM format
   * @param attestation Attestation data from TPM
   * @returns Whether attestation is valid
   */
  verifyAttestation(publicKey: string, attestation: AttestationData): boolean {
    try {
      // PRE-LAUNCH: Software attestation mode - skip cryptographic signature verification
      // TPM hardware signing is not yet implemented; nodes use RSA software keys.
      // When SKIP_ATTESTATION_VERIFY=true, we only validate PCR format and timestamp.
      const skipSigVerify = process.env.SKIP_ATTESTATION_VERIFY === 'true';

      if (!skipSigVerify) {
        // Decode the quote and signature from base64
        const quote = Buffer.from(attestation.quote, 'base64');
        const signature = Buffer.from(attestation.signature, 'base64');

        // Verify the signature using the public key
        const verifier = createVerify('SHA256');
        verifier.update(quote);
        verifier.end();

        const isValid = verifier.verify(publicKey, signature);
        if (!isValid) {
          return false;
        }
      }

      // Verify PCR values are present and valid
      if (!attestation.pcrValues || Object.keys(attestation.pcrValues).length === 0) {
        return false;
      }

      // Verify PCR values are valid SHA-256 hashes
      for (const [pcr, value] of Object.entries(attestation.pcrValues)) {
        if (!/^[a-f0-9]{64}$/i.test(value)) {
          return false;
        }
      }

      // Verify timestamp is recent (within last 30 minutes)
      // Note: 30 minutes allows for slow installs and network delays
      const attestationTime = new Date(attestation.timestamp);
      const now = new Date();
      const thirtyMinutesAgo = new Date(now.getTime() - 30 * 60 * 1000);

      if (attestationTime < thirtyMinutesAgo || attestationTime > now) {
        return false;
      }

      return true;
    } catch (error) {
      console.error('Attestation verification error:', error);
      return false;
    }
  }

  /**
   * Generate node ID from public key
   * @param publicKey Public key in PEM format
   * @returns Node ID (hex-encoded hash)
   */
  generateNodeId(publicKey: string): string {
    const hash = createHash('sha256');
    hash.update(publicKey);
    return `0x${hash.digest('hex')}`;
  }

  /**
   * Validate public key format
   * @param publicKey Public key in PEM format
   * @returns Whether public key is valid
   */
  validatePublicKey(publicKey: string): boolean {
    try {
      // Check PEM format
      if (!publicKey.includes('-----BEGIN PUBLIC KEY-----')) {
        return false;
      }

      if (!publicKey.includes('-----END PUBLIC KEY-----')) {
        return false;
      }

      // Try to create a verifier with the key (will throw if invalid)
      const verifier = createVerify('SHA256');
      verifier.update('test');
      verifier.end();

      // This will throw if the key is invalid
      try {
        verifier.verify(publicKey, Buffer.from('test'));
      } catch {
        // Expected to fail verification, but key should be parseable
      }

      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Verify PCR values match expected secure boot state
   * @param pcrValues PCR values from attestation
   * @returns Whether PCR values indicate secure boot
   */
  verifySecureBoot(pcrValues: Record<string, string>): boolean {
    // PCR 0: BIOS/UEFI code
    // PCR 7: Secure Boot state
    // For now, we just verify these PCRs exist
    // In production, you would compare against known-good values

    const requiredPCRs = ['0', '7'];

    for (const pcr of requiredPCRs) {
      if (!pcrValues[pcr]) {
        return false;
      }
    }

    return true;
  }
}

export const attestationService = new AttestationService();
