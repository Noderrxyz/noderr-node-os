import { Logger } from '.';
import { EventEmitter } from 'events';

const logger = new Logger('CapitalFlowLimiter');
const createLogger = (name: string) => ({
  info: (message: string, meta?: any) => logger.info(`[${name}] INFO: ${message}`, meta),
  error: (message: string, error?: any) => logger.error(`[${name}] ERROR: ${message}`, error),
  debug: (message: string, meta?: any) => logger.debug(`[${name}] DEBUG: ${message}`, meta),
  warn: (message: string, meta?: any) => logger.warn(`[${name}] WARN: ${message}`, meta)
});

export interface FlowLimit {
  periodMs: number;
  maxAmount: number;
  maxPercentage: number;
}

export interface FlowEvent {
  id: string;
  type: 'INFLOW' | 'OUTFLOW' | 'TRANSFER';
  amount: number;
  from?: string;
  to?: string;
  timestamp: Date;
  description: string;
  approved: boolean;
  rejectionReason?: string;
}

export interface FlowMetrics {
  periodStart: Date;
  periodEnd: Date;
  totalInflow: number;
  totalOutflow: number;
  netFlow: number;
  eventCount: number;
  rejectedCount: number;
  largestFlow: FlowEvent | null;
}

export interface CapitalFlowLimiterConfig {
  totalCapital: number;
  limits: {
    minute?: FlowLimit;
    hour?: FlowLimit;
    day?: FlowLimit;
    custom?: FlowLimit[];
  };
  emergencyStopThreshold?: number; // Percentage that triggers emergency stop
  warningThreshold?: number; // Percentage that triggers warning
}

export class CapitalFlowLimiter extends EventEmitter {
  private logger: ReturnType<typeof createLogger>;
  private config: CapitalFlowLimiterConfig;
  private flowEvents: FlowEvent[] = [];
  private metricsCache: Map<string, FlowMetrics> = new Map();
  private emergencyStopTriggered: boolean = false;
  
  constructor(config: CapitalFlowLimiterConfig) {
    super();
    this.logger = createLogger('CapitalFlowLimiter');
    this.config = config;
    
    this.logger.info('Capital flow limiter initialized', {
      totalCapital: config.totalCapital,
      limits: Object.keys(config.limits).length
    });
  }
  
  /**
   * Validate a capital flow
   */
  public async validateFlow(
    type: 'INFLOW' | 'OUTFLOW' | 'TRANSFER',
    amount: number,
    description: string,
    metadata?: { from?: string; to?: string }
  ): Promise<{ approved: boolean; reason?: string; flowEvent: FlowEvent }> {
    const flowEvent: FlowEvent = {
      id: this.generateFlowId(),
      type,
      amount,
      from: metadata?.from,
      to: metadata?.to,
      timestamp: new Date(),
      description,
      approved: false
    };
    
    // Check emergency stop
    if (this.emergencyStopTriggered) {
      flowEvent.rejectionReason = 'Emergency stop active';
      this.flowEvents.push(flowEvent);
      this.emit('flow-rejected', flowEvent);
      return { approved: false, reason: flowEvent.rejectionReason, flowEvent };
    }
    
    // Validate against all configured limits
    const violations: string[] = [];
    
    // Check minute limit
    if (this.config.limits.minute) {
      const violation = this.checkLimit('minute', this.config.limits.minute, amount, type);
      if (violation) violations.push(violation);
    }
    
    // Check hour limit
    if (this.config.limits.hour) {
      const violation = this.checkLimit('hour', this.config.limits.hour, amount, type);
      if (violation) violations.push(violation);
    }
    
    // Check day limit
    if (this.config.limits.day) {
      const violation = this.checkLimit('day', this.config.limits.day, amount, type);
      if (violation) violations.push(violation);
    }
    
    // Check custom limits
    if (this.config.limits.custom) {
      for (const limit of this.config.limits.custom) {
        const violation = this.checkLimit(`custom-${limit.periodMs}`, limit, amount, type);
        if (violation) violations.push(violation);
      }
    }
    
    // Make decision
    if (violations.length > 0) {
      flowEvent.approved = false;
      flowEvent.rejectionReason = violations.join('; ');
      
      this.logger.warn('Capital flow rejected', {
        type,
        amount,
        violations
      });
      
      this.emit('flow-rejected', flowEvent);
    } else {
      flowEvent.approved = true;
      
      this.logger.info('Capital flow approved', {
        type,
        amount,
        description
      });
      
      // Check warning threshold
      this.checkWarningThreshold(amount, type);
      
      // Check emergency threshold
      this.checkEmergencyThreshold(amount, type);
      
      this.emit('flow-approved', flowEvent);
    }
    
    // Record the event
    this.flowEvents.push(flowEvent);
    this.invalidateMetricsCache();
    
    return {
      approved: flowEvent.approved,
      reason: flowEvent.rejectionReason,
      flowEvent
    };
  }
  
  /**
   * Get flow metrics for a period
   */
  public getMetrics(periodMs: number): FlowMetrics {
    const cacheKey = `metrics-${periodMs}`;
    const cached = this.metricsCache.get(cacheKey);
    
    if (cached && cached.periodEnd.getTime() > Date.now() - 1000) {
      return cached;
    }
    
    const now = Date.now();
    const periodStart = new Date(now - periodMs);
    const periodEnd = new Date(now);
    
    const relevantEvents = this.flowEvents.filter(
      event => event.timestamp.getTime() >= periodStart.getTime()
    );
    
    let totalInflow = 0;
    let totalOutflow = 0;
    let rejectedCount = 0;
    let largestFlow: FlowEvent | null = null;
    
    for (const event of relevantEvents) {
      if (!event.approved) {
        rejectedCount++;
        continue;
      }
      
      if (event.type === 'INFLOW') {
        totalInflow += event.amount;
      } else if (event.type === 'OUTFLOW') {
        totalOutflow += event.amount;
      }
      
      if (!largestFlow || event.amount > largestFlow.amount) {
        largestFlow = event;
      }
    }
    
    const metrics: FlowMetrics = {
      periodStart,
      periodEnd,
      totalInflow,
      totalOutflow,
      netFlow: totalInflow - totalOutflow,
      eventCount: relevantEvents.length,
      rejectedCount,
      largestFlow
    };
    
    this.metricsCache.set(cacheKey, metrics);
    
    return metrics;
  }
  
  /**
   * Reset emergency stop
   */
  public resetEmergencyStop(reason: string): void {
    if (!this.emergencyStopTriggered) {
      return;
    }
    
    this.emergencyStopTriggered = false;
    this.logger.info('Emergency stop reset', { reason });
    this.emit('emergency-stop-reset', { reason });
  }
  
  /**
   * Update total capital
   */
  public updateTotalCapital(newTotal: number): void {
    const oldTotal = this.config.totalCapital;
    this.config.totalCapital = newTotal;
    
    this.logger.info('Total capital updated', {
      oldTotal,
      newTotal,
      change: newTotal - oldTotal
    });
    
    this.emit('capital-updated', {
      oldTotal,
      newTotal
    });
  }
  
  /**
   * Get flow history
   */
  public getFlowHistory(
    filter?: {
      type?: 'INFLOW' | 'OUTFLOW' | 'TRANSFER';
      approved?: boolean;
      startDate?: Date;
      endDate?: Date;
    }
  ): FlowEvent[] {
    let events = [...this.flowEvents];
    
    if (filter) {
      if (filter.type) {
        events = events.filter(e => e.type === filter.type);
      }
      
      if (filter.approved !== undefined) {
        events = events.filter(e => e.approved === filter.approved);
      }
      
      if (filter.startDate) {
        const startDate = filter.startDate;
        events = events.filter(e => e.timestamp >= startDate);
      }
      
      if (filter.endDate) {
        const endDate = filter.endDate;
        events = events.filter(e => e.timestamp <= endDate);
      }
    }
    
    return events;
  }
  
  /**
   * Clear old flow events
   */
  public cleanup(olderThanMs: number = 7 * 24 * 60 * 60 * 1000): number {
    const cutoff = Date.now() - olderThanMs;
    const before = this.flowEvents.length;
    
    this.flowEvents = this.flowEvents.filter(
      event => event.timestamp.getTime() > cutoff
    );
    
    const removed = before - this.flowEvents.length;
    
    if (removed > 0) {
      this.logger.info(`Cleaned up ${removed} old flow events`);
      this.invalidateMetricsCache();
    }
    
    return removed;
  }
  
  // Private methods
  
  private generateFlowId(): string {
    return `flow-${Date.now()}-${Math.random().toString(36).substring(7)}`;
  }
  
  private checkLimit(
    name: string,
    limit: FlowLimit,
    amount: number,
    type: 'INFLOW' | 'OUTFLOW' | 'TRANSFER'
  ): string | null {
    const metrics = this.getMetrics(limit.periodMs);
    
    // Calculate what the new total would be
    let projectedTotal = 0;
    if (type === 'OUTFLOW' || type === 'TRANSFER') {
      projectedTotal = metrics.totalOutflow + amount;
    } else {
      // For inflows, we might want different logic
      return null;
    }
    
    // Check absolute limit
    if (limit.maxAmount && projectedTotal > limit.maxAmount) {
      return `Exceeds ${name} absolute limit: ${projectedTotal} > ${limit.maxAmount}`;
    }
    
    // Check percentage limit
    if (limit.maxPercentage) {
      const percentage = (projectedTotal / this.config.totalCapital) * 100;
      if (percentage > limit.maxPercentage) {
        return `Exceeds ${name} percentage limit: ${percentage.toFixed(2)}% > ${limit.maxPercentage}%`;
      }
    }
    
    return null;
  }
  
  private checkWarningThreshold(amount: number, type: string): void {
    if (!this.config.warningThreshold || type === 'INFLOW') {
      return;
    }
    
    const percentage = (amount / this.config.totalCapital) * 100;
    
    if (percentage >= this.config.warningThreshold) {
      this.logger.warn('Large capital flow warning', {
        amount,
        percentage: percentage.toFixed(2),
        type
      });
      
      this.emit('warning-threshold', {
        amount,
        percentage,
        type,
        threshold: this.config.warningThreshold
      });
    }
  }
  
  private checkEmergencyThreshold(amount: number, type: string): void {
    if (!this.config.emergencyStopThreshold || type === 'INFLOW') {
      return;
    }
    
    const percentage = (amount / this.config.totalCapital) * 100;
    
    if (percentage >= this.config.emergencyStopThreshold) {
      this.emergencyStopTriggered = true;
      
      this.logger.error('🚨 EMERGENCY STOP TRIGGERED - Excessive capital flow', {
        amount,
        percentage: percentage.toFixed(2),
        type,
        threshold: this.config.emergencyStopThreshold
      });
      
      this.emit('emergency-stop-triggered', {
        amount,
        percentage,
        type,
        threshold: this.config.emergencyStopThreshold
      });
    }
  }
  
  private invalidateMetricsCache(): void {
    this.metricsCache.clear();
  }
  
  /**
   * Get current status
   */
  public getStatus(): {
    emergencyStopActive: boolean;
    totalCapital: number;
    recentFlows: {
      minute: FlowMetrics;
      hour: FlowMetrics;
      day: FlowMetrics;
    };
    limits: any;
  } {
    return {
      emergencyStopActive: this.emergencyStopTriggered,
      totalCapital: this.config.totalCapital,
      recentFlows: {
        minute: this.getMetrics(60 * 1000),
        hour: this.getMetrics(60 * 60 * 1000),
        day: this.getMetrics(24 * 60 * 60 * 1000)
      },
      limits: this.config.limits
    };
  }
  
  /**
   * Destroy and clean up
   */
  public destroy(): void {
    this.flowEvents = [];
    this.metricsCache.clear();
    this.removeAllListeners();
    this.logger.info('Capital flow limiter destroyed');
  }
} 