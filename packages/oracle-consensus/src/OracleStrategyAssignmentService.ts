/**
 * Oracle Strategy Assignment Service
 * 
 * Monitors StrategyRegistry for LIVE strategies and assigns them to appropriate vaults
 * based on risk scores using StrategyAssignmentRouter.
 * 
 * This service runs on Oracle nodes and performs the following:
 * 1. Listen for StrategyStatusChanged events (PAPER_TRADING → LIVE)
 * 2. Calculate strategy risk score
 * 3. Determine strategy type (LONG_ONLY, SHORT_ONLY, etc.)
 * 4. Call StrategyAssignmentRouter.assignStrategy()
 * 5. Monitor assignment success
 * 
 * @module OracleStrategyAssignmentService
 */

import { ethers } from 'ethers';
import { EventEmitter } from 'events';
import { Logger } from '@noderr/utils';

export interface StrategyAssignmentRequest {
  strategyId: string;
  riskScore: number;
  strategyType: number; // 0=LONG_ONLY, 1=SHORT_ONLY, 2=LONG_SHORT, 3=MARKET_NEUTRAL, 4=DIRECTIONAL
  status: 'pending' | 'assigned' | 'failed';
  assignedVault?: string;
  error?: string;
}

export interface StrategyRiskProfile {
  strategyId: string;
  maxDrawdown: number;
  sharpeRatio: number;
  volatility: number;
  leverage: number;
  correlationRisk: number;
  liquidityRisk: number;
  overallRiskScore: number; // 0-100
}

export class OracleStrategyAssignmentService extends EventEmitter {
  private logger: Logger;
  private provider: ethers.Provider;
  private wallet: ethers.Wallet;
  private strategyRegistry: ethers.Contract;
  private strategyAssignmentRouter: ethers.Contract;
  private isRunning: boolean;
  private pendingAssignments: Map<string, StrategyAssignmentRequest>;
  private assignedStrategies: Set<string>;

  constructor(
    provider: ethers.Provider,
    wallet: ethers.Wallet,
    strategyRegistryAddress: string,
    strategyAssignmentRouterAddress: string
  ) {
    super();
    this.logger = new Logger('OracleStrategyAssignmentService');
    this.provider = provider;
    this.wallet = wallet;
    this.isRunning = false;
    this.pendingAssignments = new Map();
    this.assignedStrategies = new Set();

    // Initialize contracts
    this.strategyRegistry = new ethers.Contract(
      strategyRegistryAddress,
      this.getStrategyRegistryABI(),
      wallet
    );

    this.strategyAssignmentRouter = new ethers.Contract(
      strategyAssignmentRouterAddress,
      this.getStrategyAssignmentRouterABI(),
      wallet
    );

    this.logger.info('OracleStrategyAssignmentService initialized', {
      oracle: wallet.address,
      strategyRegistry: strategyRegistryAddress,
      strategyAssignmentRouter: strategyAssignmentRouterAddress
    });
  }

  /**
   * Initialize the service
   */
  async initialize(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn('Service already running');
      return;
    }

    this.logger.info('Initializing OracleStrategyAssignmentService...');

    // Verify we have ORACLE_ROLE
    const ORACLE_ROLE = ethers.keccak256(ethers.toUtf8Bytes('ORACLE_ROLE'));
    const hasRole = await this.strategyAssignmentRouter.hasRole(ORACLE_ROLE, this.wallet.address);

    if (!hasRole) {
      throw new Error('Wallet does not have ORACLE_ROLE on StrategyAssignmentRouter');
    }

    this.logger.info('✅ ORACLE_ROLE verified');

    // Listen to StrategyRegistry events
    this.strategyRegistry.on(
      'StrategyStatusChanged',
      this.handleStrategyStatusChanged.bind(this)
    );

    // Listen to StrategyAssignmentRouter events
    this.strategyAssignmentRouter.on(
      'StrategyAssigned',
      this.handleStrategyAssigned.bind(this)
    );

    this.isRunning = true;
    this.logger.info('OracleStrategyAssignmentService initialized successfully');
  }

  /**
   * Handle StrategyStatusChanged event
   * 
   * Triggered when a strategy changes status (e.g., PAPER_TRADING → LIVE)
   */
  private async handleStrategyStatusChanged(
    strategyId: string,
    oldStatus: number,
    newStatus: number
  ): Promise<void> {
    this.logger.info(`Strategy status changed`, {
      strategyId,
      oldStatus,
      newStatus
    });

    // Only process strategies that become LIVE (status 4)
    if (newStatus !== 4) {
      this.logger.debug(`Strategy ${strategyId} not LIVE yet, skipping assignment`);
      return;
    }

    // Check if already assigned
    if (this.assignedStrategies.has(strategyId)) {
      this.logger.warn(`Strategy ${strategyId} already assigned, skipping`);
      return;
    }

    // Check if assignment is pending
    if (this.pendingAssignments.has(strategyId)) {
      this.logger.warn(`Strategy ${strategyId} assignment already pending, skipping`);
      return;
    }

    try {
      // Fetch strategy details
      const strategyData = await this.strategyRegistry.strategies(strategyId);

      // Calculate risk score
      const riskProfile = await this.calculateRiskScore(strategyId, strategyData);

      // Determine strategy type
      const strategyType = this.determineStrategyType(strategyData);

      // Create assignment request
      const request: StrategyAssignmentRequest = {
        strategyId,
        riskScore: riskProfile.overallRiskScore,
        strategyType,
        status: 'pending'
      };

      this.pendingAssignments.set(strategyId, request);

      this.logger.info(`Assigning strategy ${strategyId} to vault`, {
        riskScore: riskProfile.overallRiskScore,
        strategyType
      });

      // Assign strategy to vault
      await this.assignStrategyToVault(request);

    } catch (error) {
      this.logger.error(`Failed to process strategy ${strategyId}:`, error);
      
      const request = this.pendingAssignments.get(strategyId);
      if (request) {
        request.status = 'failed';
        request.error = error instanceof Error ? error.message : 'Unknown error';
      }
    }
  }

  /**
   * Assign strategy to vault using StrategyAssignmentRouter
   */
  private async assignStrategyToVault(
    request: StrategyAssignmentRequest
  ): Promise<void> {
    this.logger.info(`Calling StrategyAssignmentRouter.assignStrategy()...`, {
      strategyId: request.strategyId,
      riskScore: request.riskScore,
      strategyType: request.strategyType
    });

    try {
      // Call assignStrategy on StrategyAssignmentRouter
      const tx = await this.strategyAssignmentRouter.assignStrategy(
        request.strategyId,
        request.riskScore,
        request.strategyType
      );

      this.logger.info(`Assignment transaction submitted, tx: ${tx.hash}`);

      // Wait for confirmation
      const receipt = await tx.wait();

      if (receipt.status === 1) {
        this.logger.info(`Strategy ${request.strategyId} assigned successfully`);
        request.status = 'assigned';
        
        // Extract assigned vault from event logs
        const event = receipt.logs.find((log: any) => {
          try {
            const parsed = this.strategyAssignmentRouter.interface.parseLog(log);
            return parsed?.name === 'StrategyAssigned';
          } catch {
            return false;
          }
        });

        if (event) {
          const parsed = this.strategyAssignmentRouter.interface.parseLog(event);
          request.assignedVault = parsed?.args.vaultAddress;
          this.logger.info(`Strategy assigned to vault: ${request.assignedVault}`);
        }

        this.emit('strategyAssigned', request);
      } else {
        throw new Error('Transaction failed');
      }

    } catch (error) {
      this.logger.error(`Failed to assign strategy ${request.strategyId}:`, error);
      request.status = 'failed';
      request.error = error instanceof Error ? error.message : 'Unknown error';
      throw error;
    }
  }

  /**
   * Calculate strategy risk score (0-100)
   * 
   * Risk factors:
   * - Max drawdown (30%)
   * - Sharpe ratio (20%)
   * - Volatility (20%)
   * - Leverage (15%)
   * - Correlation risk (10%)
   * - Liquidity risk (5%)
   */
  private async calculateRiskScore(
    strategyId: string,
    strategyData: any
  ): Promise<StrategyRiskProfile> {
    this.logger.debug(`Calculating risk score for strategy ${strategyId}...`);

    // Extract performance metrics
    const performance = strategyData.performance;
    const riskParams = strategyData.riskParams;

    // Calculate individual risk components (0-100 scale)
    const drawdownRisk = Math.min(100, (Number(performance.maxDrawdown) / 100) * 100); // 0-100%
    const sharpeRisk = Math.max(0, 100 - (Number(performance.sharpeRatio) / 100) * 50); // Higher Sharpe = lower risk
    const volatilityRisk = 50; // Placeholder - would calculate from price history
    const leverageRisk = Math.min(100, (Number(riskParams.maxLeverage) / 10) * 100); // 1-10x leverage
    const correlationRisk = Math.min(100, Number(riskParams.correlationThreshold) / 10); // 0-1000 bps
    const liquidityRisk = riskParams.flashLoansEnabled ? 80 : 20; // Flash loans = higher risk

    // Weighted average
    const overallRiskScore = Math.round(
      drawdownRisk * 0.30 +
      sharpeRisk * 0.20 +
      volatilityRisk * 0.20 +
      leverageRisk * 0.15 +
      correlationRisk * 0.10 +
      liquidityRisk * 0.05
    );

    const riskProfile: StrategyRiskProfile = {
      strategyId,
      maxDrawdown: drawdownRisk,
      sharpeRatio: sharpeRisk,
      volatility: volatilityRisk,
      leverage: leverageRisk,
      correlationRisk,
      liquidityRisk,
      overallRiskScore: Math.min(100, Math.max(0, overallRiskScore))
    };

    this.logger.info(`Risk score calculated`, {
      strategyId,
      overallRiskScore: riskProfile.overallRiskScore,
      components: {
        drawdown: drawdownRisk.toFixed(1),
        sharpe: sharpeRisk.toFixed(1),
        volatility: volatilityRisk.toFixed(1),
        leverage: leverageRisk.toFixed(1),
        correlation: correlationRisk.toFixed(1),
        liquidity: liquidityRisk.toFixed(1)
      }
    });

    return riskProfile;
  }

  /**
   * Determine strategy type based on strategy characteristics
   * 
   * Returns:
   * 0 = LONG_ONLY
   * 1 = SHORT_ONLY
   * 2 = LONG_SHORT
   * 3 = MARKET_NEUTRAL
   * 4 = DIRECTIONAL
   */
  private determineStrategyType(strategyData: any): number {
    // Simplified logic - actual implementation would analyze strategy code
    const riskParams = strategyData.riskParams;

    // Check if flash loans enabled (typically for market-neutral strategies)
    if (riskParams.flashLoansEnabled) {
      return 3; // MARKET_NEUTRAL
    }

    // Check leverage (high leverage typically for directional strategies)
    if (Number(riskParams.maxLeverage) > 5) {
      return 4; // DIRECTIONAL
    }

    // Check correlation threshold (low correlation = market-neutral)
    if (Number(riskParams.correlationThreshold) < 300) { // < 30%
      return 3; // MARKET_NEUTRAL
    }

    // Default to LONG_SHORT
    return 2; // LONG_SHORT
  }

  /**
   * Handle StrategyAssigned event from StrategyAssignmentRouter
   */
  private handleStrategyAssigned(
    strategyId: string,
    vaultAddress: string,
    riskScore: number
  ): void {
    this.logger.info(`Strategy assigned event received`, {
      strategyId,
      vaultAddress,
      riskScore: Number(riskScore)
    });

    // Mark as assigned
    this.assignedStrategies.add(strategyId);

    // Update pending assignment
    const request = this.pendingAssignments.get(strategyId);
    if (request) {
      request.status = 'assigned';
      request.assignedVault = vaultAddress;
      this.pendingAssignments.delete(strategyId);
    }
  }

  /**
   * Get pending assignments
   */
  getPendingAssignments(): StrategyAssignmentRequest[] {
    return Array.from(this.pendingAssignments.values());
  }

  /**
   * Get assigned strategies
   */
  getAssignedStrategies(): string[] {
    return Array.from(this.assignedStrategies);
  }

  /**
   * Get StrategyRegistry ABI (minimal)
   */
  private getStrategyRegistryABI(): any[] {
    return [
      'event StrategyStatusChanged(bytes32 indexed strategyId, uint8 oldStatus, uint8 newStatus)',
      'function strategies(bytes32) view returns (bool isDNA, bytes32 dnaString, address strategyContract, string name, string description, uint8 status, uint256 createdAt, uint256 lastStatusChange, address submitter, tuple(uint256 maxPositionSizePercent, uint256 maxLeverage, uint256 stopLossPercent, uint256 slippageToleranceBps, uint256 correlationThreshold, uint256 velocityLimit, bool flashLoansEnabled) riskParams, tuple(int256 totalPnL, uint256 sharpeRatio, uint256 maxDrawdown, uint256 winRate, uint256 totalTrades, uint256 paperTradingStart, uint256 paperTradingEnd) performance, uint256 initialAllocation, bool requiresOracleApproval)'
    ];
  }

  /**
   * Get StrategyAssignmentRouter ABI (minimal)
   */
  private getStrategyAssignmentRouterABI(): any[] {
    return [
      'function assignStrategy(bytes32 strategyId, uint256 riskScore, uint8 strategyType) external returns (address)',
      'function hasRole(bytes32 role, address account) view returns (bool)',
      'event StrategyAssigned(bytes32 indexed strategyId, address indexed vaultAddress, uint256 riskScore)'
    ];
  }

  /**
   * Stop the service
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    this.logger.info('Stopping OracleStrategyAssignmentService...');

    // Remove event listeners
    this.strategyRegistry.removeAllListeners();
    this.strategyAssignmentRouter.removeAllListeners();

    // Wait for pending assignments
    if (this.pendingAssignments.size > 0) {
      this.logger.warn(`${this.pendingAssignments.size} pending assignments still processing`);
    }

    this.isRunning = false;
    this.logger.info('OracleStrategyAssignmentService stopped');
  }
}

export default OracleStrategyAssignmentService;
