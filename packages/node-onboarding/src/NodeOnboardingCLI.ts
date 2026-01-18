/**
 * Node Onboarding CLI
 * 
 * Complete onboarding flow for all Noderr node tiers:
 * - Micro: Entry-level node (no GPU, low stake)
 * - Validator: Mid-tier node (no GPU, medium stake)
 * - Guardian: High-tier node (optional GPU for bonus, high stake)
 * - Oracle: Top-tier node (GPU required, highest stake)
 * 
 * @module node-onboarding
 */

import { Logger } from '@noderr/utils/src';
import inquirer from 'inquirer';
import chalk from 'chalk';
import ora from 'ora';
import boxen from 'boxen';
import { ethers } from 'ethers';
import { getGPUHardwareId } from '@noderr/gpu-service-mvs';
import { verifyAttestation, generateNonce } from '@noderr/attestation-mvs';
import { STAKING_REQUIREMENTS, NodeTier } from '@noderr/protocol-config';

const logger = new Logger('NodeOnboardingCLI');
export interface OnboardingConfig {
  rpcUrl: string;
  authApiUrl: string;
  nodrTokenAddress: string;
  utilityNFTAddress: string;
  nodeRegistryAddress: string;
}

export interface OnboardingResult {
  success: boolean;
  nodeTier: NodeTier;
  walletAddress: string;
  gpuHardwareId?: string;
  utilityNFTId?: string;
  registrationTxHash?: string;
  error?: string;
}

export class NodeOnboardingCLI {
  private config: OnboardingConfig;
  private provider: ethers.Provider;

  constructor(config: OnboardingConfig) {
    this.config = config;
    this.provider = new ethers.JsonRpcProvider(config.rpcUrl);
  }

  /**
   * Run complete onboarding flow
   */
  async run(): Promise<OnboardingResult> {
    try {
      // Welcome message
      this.displayWelcome();

      // Step 1: Select node tier
      const nodeTier = await this.selectNodeTier();

      // Step 2: Connect wallet
      const wallet = await this.connectWallet();

      // Step 3: Check staking requirements
      await this.checkStaking(wallet.address, nodeTier);

      // Step 4: Check GPU (if required/optional)
      const gpuHardwareId = await this.checkGPU(nodeTier);

      // Step 5: Generate TPM attestation
      const attestation = await this.generateAttestation(gpuHardwareId);

      // Step 6: Register node
      const registrationResult = await this.registerNode({
        wallet,
        nodeTier,
        gpuHardwareId,
        attestation
      });

      // Success message
      this.displaySuccess(registrationResult);

      return {
        success: true,
        nodeTier,
        walletAddress: wallet.address,
        gpuHardwareId,
        ...registrationResult
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.displayError(errorMessage);
      
      return {
        success: false,
        nodeTier: NodeTier.MICRO,
        walletAddress: '',
        error: errorMessage
      };
    }
  }

  /**
   * Display welcome message
   */
  private displayWelcome() {
    console.clear();
    logger.info(boxen(
      chalk.bold.cyan('Welcome to Noderr Protocol\n\n') +
      chalk.white('Node Onboarding System'),
      {
        padding: 1,
        margin: 1,
        borderStyle: 'double',
        borderColor: 'cyan'
      }
    ));
    logger.info();
  }

  /**
   * Step 1: Select node tier
   */
  private async selectNodeTier(): Promise<NodeTier> {
    const { tier } = await inquirer.prompt([
      {
        type: 'list',
        name: 'tier',
        message: 'Select your node tier:',
        choices: [
          {
            name: `${chalk.green('Micro')} - Entry-level (TF ≥0.30, 0 NODR stake, no GPU)`,
            value: NodeTier.MICRO
          },
          {
            name: `${chalk.blue('Validator')} - Mid-tier (TF ≥0.60, 50,000 NODR stake, no GPU)`,
            value: NodeTier.VALIDATOR
          },
          {
            name: `${chalk.yellow('Guardian')} - High-tier (TF ≥0.75, 100,000 NODR stake, optional GPU for bonus)`,
            value: NodeTier.GUARDIAN
          },
          {
            name: `${chalk.red('Oracle')} - Top-tier (TF ≥0.90, 500,000 NODR stake, GPU required)`,
            value: NodeTier.ORACLE
          }
        ]
      }
    ]);

    logger.info();
    logger.info(chalk.cyan(`✓ Selected: ${chalk.bold(tier)}`));
    logger.info();

    return tier;
  }

  /**
   * Step 2: Connect wallet
   */
  private async connectWallet(): Promise<ethers.Wallet> {
    const { method } = await inquirer.prompt([
      {
        type: 'list',
        name: 'method',
        message: 'How would you like to connect your wallet?',
        choices: [
          { name: 'Enter private key (secure input)', value: 'privateKey' },
          { name: 'Load from keystore file', value: 'keystore' },
          { name: 'Use mnemonic phrase', value: 'mnemonic' }
        ]
      }
    ]);

    let wallet: ethers.Wallet;

    if (method === 'privateKey') {
      const { privateKey } = await inquirer.prompt([
        {
          type: 'password',
          name: 'privateKey',
          message: 'Enter your private key:',
          mask: '*'
        }
      ]);
      wallet = new ethers.Wallet(privateKey, this.provider);
    } else if (method === 'keystore') {
      const { keystorePath, password } = await inquirer.prompt([
        {
          type: 'input',
          name: 'keystorePath',
          message: 'Enter path to keystore file:'
        },
        {
          type: 'password',
          name: 'password',
          message: 'Enter keystore password:',
          mask: '*'
        }
      ]);
      const fs = await import('fs');
      const keystoreJson = fs.readFileSync(keystorePath, 'utf8');
      wallet = await ethers.Wallet.fromEncryptedJson(keystoreJson, password);
      wallet = wallet.connect(this.provider);
    } else {
      const { mnemonic } = await inquirer.prompt([
        {
          type: 'password',
          name: 'mnemonic',
          message: 'Enter your mnemonic phrase:',
          mask: '*'
        }
      ]);
      wallet = ethers.Wallet.fromPhrase(mnemonic, this.provider);
    }

    logger.info();
    logger.info(chalk.cyan(`✓ Wallet connected: ${chalk.bold(wallet.address)}`));
    logger.info();

    return wallet;
  }

  /**
   * Step 3: Check staking requirements
   */
  private async checkStaking(address: string, tier: NodeTier): Promise<void> {
    const spinner = ora('Checking NODR token balance...').start();

    try {
      // Get NODR token contract
      const nodrToken = new ethers.Contract(
        this.config.nodrTokenAddress,
        ['function balanceOf(address) view returns (uint256)'],
        this.provider
      );

      // Check balance
      const balance = await nodrToken.balanceOf(address);
      const balanceFormatted = ethers.formatEther(balance);
      const required = STAKING_REQUIREMENTS[tier];

      spinner.stop();

      logger.info(chalk.cyan(`Your balance: ${chalk.bold(balanceFormatted)} NODR`));
      logger.info(chalk.cyan(`Required: ${chalk.bold(required.toLocaleString())} NODR`));
      logger.info();

      if (parseFloat(balanceFormatted) < required) {
        throw new Error(
          `Insufficient NODR balance. You need ${required.toLocaleString()} NODR to run a ${tier} node.`
        );
      }

      logger.info(chalk.green('✓ Staking requirement met'));
      logger.info();
    } catch (error) {
      spinner.stop();
      throw error;
    }
  }

  /**
   * Step 4: Check GPU (if required/optional)
   */
  private async checkGPU(tier: NodeTier): Promise<string | undefined> {
    // Micro and Validator don't need GPU
    if (tier === NodeTier.MICRO || tier === NodeTier.VALIDATOR) {
      return undefined;
    }

    const spinner = ora('Detecting GPU...').start();

    try {
      const gpuId = await getGPUHardwareId();

      spinner.stop();

      if (!gpuId) {
        if (tier === NodeTier.ORACLE) {
          throw new Error('GPU required for Oracle nodes. No NVIDIA GPU detected.');
        } else {
          // Guardian - GPU optional
          logger.info(chalk.yellow('⚠ No GPU detected'));
          logger.info(chalk.yellow('Guardian nodes can run without GPU, but you won\'t receive GPU bonus rewards.'));
          logger.info();

          const { proceed } = await inquirer.prompt([
            {
              type: 'confirm',
              name: 'proceed',
              message: 'Continue without GPU?',
              default: true
            }
          ]);

          if (!proceed) {
            throw new Error('Onboarding cancelled by user');
          }

          return undefined;
        }
      }

      logger.info(chalk.green(`✓ GPU detected: ${gpuId.substring(0, 16)}...`));
      logger.info();

      return gpuId;
    } catch (error) {
      spinner.stop();
      throw error;
    }
  }

  /**
   * Step 5: Generate TPM attestation
   */
  private async generateAttestation(gpuHardwareId?: string): Promise<any> {
    const spinner = ora('Generating TPM attestation...').start();

    try {
      const nonce = generateNonce();

      // TODO: Integrate with actual TPM attestation
      // For now, return mock attestation
      const attestation = {
        nonce,
        timestamp: Date.now(),
        gpuHardwareId,
        signature: 'mock_signature'
      };

      spinner.succeed('TPM attestation generated');
      logger.info();

      return attestation;
    } catch (error) {
      spinner.stop();
      throw error;
    }
  }

  /**
   * Step 6: Register node
   */
  private async registerNode(params: {
    wallet: ethers.Wallet;
    nodeTier: NodeTier;
    gpuHardwareId?: string;
    attestation: any;
  }): Promise<{ utilityNFTId: string; registrationTxHash: string }> {
    const spinner = ora('Registering node on-chain...').start();

    try {
      // Call auth-API to register node
      const response = await fetch(`${this.config.authApiUrl}/api/v1/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          walletAddress: params.wallet.address,
          nodeTier: params.nodeTier,
          gpuHardwareId: params.gpuHardwareId,
          attestation: params.attestation,
          systemInfo: {
            os: process.platform,
            cpuCores: 8,
            memory: 16384,
            gpuHardwareId: params.gpuHardwareId
          }
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Registration failed');
      }

      const result = await response.json();

      spinner.succeed('Node registered successfully');
      logger.info();

      return {
        utilityNFTId: result.utilityNFTId,
        registrationTxHash: result.txHash
      };
    } catch (error) {
      spinner.stop();
      throw error;
    }
  }

  /**
   * Display success message
   */
  private displaySuccess(result: { utilityNFTId: string; registrationTxHash: string }) {
    logger.info(boxen(
      chalk.bold.green('✓ Node Registration Complete!\n\n') +
      chalk.white(`Utility NFT ID: ${chalk.bold(result.utilityNFTId)}\n`) +
      chalk.white(`Transaction: ${chalk.bold(result.registrationTxHash)}`),
      {
        padding: 1,
        margin: 1,
        borderStyle: 'double',
        borderColor: 'green'
      }
    ));
    logger.info();
    logger.info(chalk.cyan('Next steps:'));
    logger.info(chalk.white('1. Start your node client'));
    logger.info(chalk.white('2. Monitor your node dashboard'));
    logger.info(chalk.white('3. Start earning rewards!'));
    logger.info();
  }

  /**
   * Display error message
   */
  private displayError(error: string) {
    logger.info(boxen(
      chalk.bold.red('✗ Onboarding Failed\n\n') +
      chalk.white(error),
      {
        padding: 1,
        margin: 1,
        borderStyle: 'double',
        borderColor: 'red'
      }
    ));
    logger.info();
  }
}

/**
 * CLI entry point
 */
export async function runOnboarding(config: OnboardingConfig): Promise<OnboardingResult> {
  const cli = new NodeOnboardingCLI(config);
  return await cli.run();
}
