/**
 * Node Registration Example with GPU Integration
 * 
 * This example shows how to integrate GPU detection into the node registration flow
 */

import { Logger } from '@noderr/utils';
import { getSystemInfoWithGpu, hasGpu } from './gpu-integration';

/**
 * Example: Register node with GPU detection
 */
async function registerNode(
  installToken: string,
  publicKey: string,
  walletAddress: string,
  nodeTier: 'micro' | 'validator' | 'guardian' | 'oracle'
) {
  logger.info('🚀 Starting node registration...\n');

  // Step 1: Check GPU requirements based on node tier
  const gpuAvailable = await hasGpu();
  
  if (nodeTier === 'oracle') {
    // Oracle nodes REQUIRE a GPU
    if (!gpuAvailable) {
      throw new Error(
        '❌ Oracle nodes require a GPU. No GPU detected on this system.\n' +
        '   Please ensure you have a compatible GPU installed and drivers configured.'
      );
    }
    logger.info('✅ GPU requirement met for Oracle node\n');
  } else if (nodeTier === 'guardian') {
    // Guardian nodes: GPU is optional (bonus rewards)
    if (gpuAvailable) {
      logger.info('✅ GPU detected for Guardian node (bonus rewards enabled)\n');
    } else {
      logger.info('ℹ️  No GPU detected for Guardian node (will receive base rewards only)\n');
    }
  } else {
    // Micro and Validator nodes don't use GPU
    logger.info(`ℹ️  GPU not required for ${nodeTier} node\n`);
  }

  // Step 2: Collect system information (including GPU if available)
  const baseSystemInfo = {
    hostname: 'example-node',
    cpuCores: 8,
    memoryGB: 32,
    diskGB: 512,
    osVersion: 'Ubuntu 22.04',
    kernelVersion: '5.15.0',
  };

  const systemInfo = await getSystemInfoWithGpu(baseSystemInfo);

  // Step 3: Generate TPM attestation (placeholder)
  const attestation = {
    quote: 'base64-encoded-tpm-quote',
    signature: 'base64-encoded-signature',
    pcrValues: {
      '0': 'pcr0-value',
      '1': 'pcr1-value',
    },
    timestamp: new Date().toISOString(),
  };

  // Step 4: Send registration request to auth API
  const registrationPayload = {
    installToken,
    publicKey,
    walletAddress,
    nodeTier,
    attestation,
    systemInfo, // Includes gpuHardwareId if available
  };

  logger.info('📤 Sending registration request...');
  logger.info(JSON.stringify(registrationPayload, null, 2));

  // In production, this would be an actual HTTP request:
  // const response = await fetch('https://auth-api.noderr.io/api/v1/auth/register', {
  //   method: 'POST',
  //   headers: { 'Content-Type': 'application/json' },
  //   body: JSON.stringify(registrationPayload),
  // });

  logger.info('\n✅ Node registered successfully!');
}

// Example usage
if (require.main === module) {
  registerNode(
    'example-install-token',
    'example-public-key',
    '0x1234567890123456789012345678901234567890',
    'oracle'
  )
    .then(() => {
      logger.info('\n🎉 Registration complete!');
      process.exit(0);
    })
    .catch((error) => {
      logger.error('\n❌ Registration failed:', error.message);
      process.exit(1);
    });
}

const logger = new Logger('registration-example');
export { registerNode };
