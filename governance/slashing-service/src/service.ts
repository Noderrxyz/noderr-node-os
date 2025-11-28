/**
 * Slashing Service
 * 
 * Monitors node metrics and executes slashing for misbehavior
 */

import { ethers } from 'ethers';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { SlashingRules } from './rules';
import { NodeMetrics, SlashingEvent, SlashingConfig, DEFAULT_SLASHING_CONFIG } from './types';
import pino from 'pino';

const logger = pino({ name: 'slashing-service' });

const NODE_STAKING_ABI = [
  'function slash(bytes32 nodeId, uint256 amount, string calldata reason) external',
  'function getStake(bytes32 nodeId) external view returns (tuple(uint256 amount, uint256 stakedAt, uint256 withdrawalRequestedAt, bool active))',
  'function isStaked(bytes32 nodeId) external view returns (bool)'
];

export class SlashingService {
  private provider: ethers.Provider;
  private wallet: ethers.Wallet;
  private stakingContract: ethers.Contract;
  private database: SupabaseClient;
  private rules: SlashingRules;
  private config: SlashingConfig;
  private lastSlashTime: Map<string, number>;

  constructor(
    rpcUrl: string,
    privateKey: string,
    stakingContractAddress: string,
    supabaseUrl: string,
    supabaseKey: string,
    config: SlashingConfig = DEFAULT_SLASHING_CONFIG
  ) {
    this.config = config;
    this.rules = new SlashingRules(config);
    this.lastSlashTime = new Map();

    // Setup blockchain connection
    this.provider = new ethers.JsonRpcProvider(rpcUrl);
    this.wallet = new ethers.Wallet(privateKey, this.provider);
    this.stakingContract = new ethers.Contract(
      stakingContractAddress,
      NODE_STAKING_ABI,
      this.wallet
    );

    // Setup database connection
    this.database = createClient(supabaseUrl, supabaseKey);
  }

  /**
   * Fetch node metrics from database
   */
  private async fetchNodeMetrics(nodeId: string): Promise<NodeMetrics | null> {
    try {
      // Get node info
      const { data: node, error: nodeError } = await this.database
        .from('nodes')
        .select('*')
        .eq('node_id', nodeId)
        .single();

      if (nodeError || !node) {
        logger.warn({ nodeId }, 'Node not found in database');
        return null;
      }

      // Get stake from contract
      const nodeIdBytes = ethers.id(nodeId);
      const stake = await this.stakingContract.getStake(nodeIdBytes);

      // Get recent metrics
      const lookbackHours = this.config.metricsLookbackPeriod;
      const lookbackTime = new Date(Date.now() - lookbackHours * 60 * 60 * 1000);

      const { data: metrics, error: metricsError } = await this.database
        .from('node_metrics')
        .select('*')
        .eq('node_id', nodeId)
        .gte('timestamp', lookbackTime.toISOString())
        .order('timestamp', { ascending: false });

      if (metricsError) {
        logger.error({ nodeId, error: metricsError }, 'Error fetching metrics');
        return null;
      }

      // Calculate aggregated metrics
      const uptime = this.calculateUptime(metrics || []);
      const errorRate = this.calculateErrorRate(metrics || []);
      const consecutiveFailures = this.calculateConsecutiveFailures(metrics || []);

      return {
        nodeId,
        uptime,
        errorRate,
        lastSeen: node.last_heartbeat ? new Date(node.last_heartbeat) : new Date(0),
        consecutiveFailures,
        version: node.version || '0.0.0',
        expectedVersion: node.expected_version || '0.0.0',
        stake: BigInt(stake.amount.toString()),
        tier: node.tier || 'ALL'
      };
    } catch (error) {
      logger.error({ nodeId, error }, 'Error fetching node metrics');
      return null;
    }
  }

  /**
   * Calculate uptime percentage from metrics
   */
  private calculateUptime(metrics: any[]): number {
    if (metrics.length === 0) return 0;

    const totalChecks = metrics.length;
    const successfulChecks = metrics.filter(m => m.status === 'online').length;

    return (successfulChecks / totalChecks) * 100;
  }

  /**
   * Calculate error rate (errors per hour)
   */
  private calculateErrorRate(metrics: any[]): number {
    if (metrics.length === 0) return 0;

    const totalErrors = metrics.reduce((sum, m) => sum + (m.error_count || 0), 0);
    const hoursSpan = this.config.metricsLookbackPeriod;

    return totalErrors / hoursSpan;
  }

  /**
   * Calculate consecutive failures
   */
  private calculateConsecutiveFailures(metrics: any[]): number {
    if (metrics.length === 0) return 0;

    let consecutive = 0;

    for (const metric of metrics) {
      if (metric.status !== 'online') {
        consecutive++;
      } else {
        break;
      }
    }

    return consecutive;
  }

  /**
   * Check if node can be slashed (respects cooldown)
   */
  private canSlashNode(nodeId: string): boolean {
    const lastSlash = this.lastSlashTime.get(nodeId);

    if (!lastSlash) {
      return true;
    }

    const timeSinceLastSlash = (Date.now() - lastSlash) / 1000;
    return timeSinceLastSlash >= this.config.minTimeBetweenSlashes;
  }

  /**
   * Execute slashing for a node
   */
  private async executeSlash(
    nodeId: string,
    amount: bigint,
    reason: string
  ): Promise<string> {
    logger.info({ nodeId, amount: amount.toString(), reason }, 'Executing slash');

    const nodeIdBytes = ethers.id(nodeId);

    try {
      const tx = await this.stakingContract.slash(nodeIdBytes, amount, reason);
      const receipt = await tx.wait();

      logger.info({ nodeId, txHash: receipt.hash }, 'Slash executed successfully');

      return receipt.hash;
    } catch (error: any) {
      logger.error({ nodeId, error }, 'Error executing slash');
      throw error;
    }
  }

  /**
   * Record slashing event in database
   */
  private async recordSlashingEvent(event: SlashingEvent): Promise<void> {
    try {
      const { error } = await this.database
        .from('slashing_events')
        .insert({
          node_id: event.nodeId,
          operator: event.operator,
          rule_id: event.ruleId,
          rule_name: event.ruleName,
          amount: event.amount.toString(),
          reason: event.reason,
          timestamp: event.timestamp.toISOString(),
          tx_hash: event.txHash,
          status: event.status
        });

      if (error) {
        logger.error({ error }, 'Error recording slashing event');
      }
    } catch (error) {
      logger.error({ error }, 'Error recording slashing event');
    }
  }

  /**
   * Check and slash a single node
   */
  async checkNode(nodeId: string): Promise<SlashingEvent | null> {
    logger.debug({ nodeId }, 'Checking node for slashing');

    // Fetch metrics
    const metrics = await this.fetchNodeMetrics(nodeId);

    if (!metrics) {
      logger.warn({ nodeId }, 'Could not fetch metrics for node');
      return null;
    }

    // Check if node is staked
    if (metrics.stake === BigInt(0)) {
      logger.debug({ nodeId }, 'Node not staked, skipping');
      return null;
    }

    // Check cooldown
    if (!this.canSlashNode(nodeId)) {
      logger.debug({ nodeId }, 'Node in cooldown period, skipping');
      return null;
    }

    // Evaluate rules
    const triggeredRules = this.rules.evaluateRules(metrics);

    if (triggeredRules.length === 0) {
      logger.debug({ nodeId }, 'No rules triggered');
      return null;
    }

    // Calculate slash amount
    const slashAmount = this.rules.calculateTotalSlash(metrics, triggeredRules);

    if (slashAmount === BigInt(0)) {
      logger.debug({ nodeId }, 'Slash amount is zero, skipping');
      return null;
    }

    // Get most severe rule
    const mostSevereRule = this.rules.getMostSevereRule(triggeredRules);
    const reason = this.rules.generateSlashReason(triggeredRules);

    logger.warn(
      { nodeId, slashAmount: slashAmount.toString(), reason, triggeredRules: triggeredRules.length },
      'Slashing node'
    );

    // Execute slash
    let txHash: string | undefined;
    let status: 'pending' | 'executed' | 'failed' = 'pending';

    try {
      txHash = await this.executeSlash(nodeId, slashAmount, reason);
      status = 'executed';
      this.lastSlashTime.set(nodeId, Date.now());
    } catch (error) {
      logger.error({ nodeId, error }, 'Failed to execute slash');
      status = 'failed';
    }

    // Record event
    const event: SlashingEvent = {
      nodeId,
      operator: '', // Would need to fetch from contract
      ruleId: mostSevereRule?.id || 'unknown',
      ruleName: mostSevereRule?.name || 'Unknown',
      amount: slashAmount,
      reason,
      timestamp: new Date(),
      txHash,
      status
    };

    await this.recordSlashingEvent(event);

    return event;
  }

  /**
   * Check all active nodes
   */
  async checkAllNodes(): Promise<SlashingEvent[]> {
    logger.info('Checking all nodes for slashing');

    try {
      // Get all active nodes from database
      const { data: nodes, error } = await this.database
        .from('nodes')
        .select('node_id')
        .eq('status', 'active');

      if (error) {
        logger.error({ error }, 'Error fetching active nodes');
        return [];
      }

      if (!nodes || nodes.length === 0) {
        logger.info('No active nodes to check');
        return [];
      }

      logger.info({ count: nodes.length }, 'Checking nodes');

      // Check each node
      const events: SlashingEvent[] = [];

      for (const node of nodes) {
        const event = await this.checkNode(node.node_id);
        if (event) {
          events.push(event);
        }
      }

      logger.info({ slashedCount: events.length }, 'Slashing check complete');

      return events;
    } catch (error) {
      logger.error({ error }, 'Error checking all nodes');
      return [];
    }
  }

  /**
   * Get slashing statistics
   */
  async getStatistics(days: number = 7): Promise<any> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const { data: events, error } = await this.database
      .from('slashing_events')
      .select('*')
      .gte('timestamp', since.toISOString());

    if (error || !events) {
      return {
        totalEvents: 0,
        totalSlashed: '0',
        byRule: {},
        bySeverity: {}
      };
    }

    const totalSlashed = events.reduce(
      (sum, e) => sum + BigInt(e.amount),
      BigInt(0)
    );

    const byRule: Record<string, number> = {};
    const bySeverity: Record<string, number> = {};

    for (const event of events) {
      byRule[event.rule_name] = (byRule[event.rule_name] || 0) + 1;
      // Would need to fetch severity from rule
    }

    return {
      totalEvents: events.length,
      totalSlashed: totalSlashed.toString(),
      byRule,
      bySeverity
    };
  }
}
