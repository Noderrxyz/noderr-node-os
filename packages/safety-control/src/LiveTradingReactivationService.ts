import { Logger } from '@noderr/utils';
import { EventEmitter } from 'events';
import { SafetyController } from './SafetyController';
import * as fs from 'fs';
import * as path from 'path';

const logger = new Logger('LiveTradingReactivationService');
const createLogger = (name: string) => ({
  info: (message: string, meta?: any) => logger.info(`[${name}] INFO: ${message}`, meta),
  error: (message: string, error?: any) => logger.error(`[${name}] ERROR: ${message}`, error),
  debug: (message: string, meta?: any) => logger.debug(`[${name}] DEBUG: ${message}`, meta),
  warn: (message: string, meta?: any) => logger.warn(`[${name}] WARN: ${message}`, meta)
});

interface ReactivationCriteria {
  backtestPassed: boolean;
  backtestResults?: {
    scenarios: string[];
    avgSharpe: number;
    worstDrawdown: number;
    passRate: number;
  };
  paperTradingSharpe: number;
  paperTradingDays: number;
  paperTradingMetrics?: {
    totalTrades: number;
    winRate: number;
    avgDailyReturn: number;
    maxDrawdown: number;
  };
  chaosTestsPassed: boolean;
  chaosTestResults?: {
    scenariosTested: number;
    recoveryRate: number;
    avgRecoveryTime: number;
  };
  manualApproval?: {
    approved: boolean;
    approvedBy: string;
    timestamp: Date;
    notes?: string;
  };
}

interface ReactivationAttempt {
  timestamp: Date;
  requestedBy: string;
  criteria: ReactivationCriteria;
  result: 'approved' | 'rejected';
  reason?: string;
}

export class LiveTradingReactivationService extends EventEmitter {
  private static instance: LiveTradingReactivationService;
  private logger: ReturnType<typeof createLogger>;
  private safetyController: SafetyController;
  private criteria: ReactivationCriteria;
  private reactivationAttempts: ReactivationAttempt[] = [];
  
  // Configurable thresholds
  private readonly REQUIRED_SHARPE = 2.0;
  private readonly REQUIRED_PAPER_DAYS = 30;
  private readonly REQUIRED_CHAOS_RECOVERY = 0.95; // 95% recovery rate
  private readonly REQUIRED_BACKTEST_PASS_RATE = 0.8; // 80% scenarios passed
  
  private criteriaFilePath = path.join(process.cwd(), '.reactivation-criteria.json');
  
  private constructor() {
    super();
    this.logger = createLogger('LiveTradingReactivation');
    this.safetyController = SafetyController.getInstance();
    
    // Initialize criteria
    this.criteria = this.loadPersistedCriteria() || {
      backtestPassed: false,
      paperTradingSharpe: 0,
      paperTradingDays: 0,
      chaosTestsPassed: false
    };
    
    // Log initial state
    this.logger.info('LiveTradingReactivationService initialized', {
      currentCriteria: this.getCriteriaSummary()
    });
  }
  
  public static getInstance(): LiveTradingReactivationService {
    if (!LiveTradingReactivationService.instance) {
      LiveTradingReactivationService.instance = new LiveTradingReactivationService();
    }
    return LiveTradingReactivationService.instance;
  }
  
  private loadPersistedCriteria(): ReactivationCriteria | null {
    try {
      if (fs.existsSync(this.criteriaFilePath)) {
        const data = fs.readFileSync(this.criteriaFilePath, 'utf8');
        return JSON.parse(data);
      }
    } catch (error) {
      this.logger.error('Failed to load persisted criteria', error);
    }
    return null;
  }
  
  private persistCriteria(): void {
    try {
      fs.writeFileSync(
        this.criteriaFilePath, 
        JSON.stringify(this.criteria, null, 2)
      );
    } catch (error) {
      this.logger.error('Failed to persist criteria', error);
    }
  }
  
  public updateCriteria(updates: Partial<ReactivationCriteria>): void {
    const previousCriteria = { ...this.criteria };
    this.criteria = { ...this.criteria, ...updates };
    
    this.logger.info('Reactivation criteria updated', {
      updates,
      previousCriteria: this.getCriteriaSummary(previousCriteria),
      newCriteria: this.getCriteriaSummary()
    });
    
    // Persist to disk
    this.persistCriteria();
    
    // Check if we're ready
    this.checkReactivationReadiness();
    
    // Emit update event
    this.emit('criteria-updated', {
      previous: previousCriteria,
      current: this.criteria,
      timestamp: Date.now()
    });
  }
  
  private checkReactivationReadiness(): void {
    const evaluation = this.evaluateCriteria();
    
    if (evaluation.ready) {
      this.logger.info('🎯 System meets all reactivation criteria!', evaluation);
      this.emit('ready-for-reactivation', {
        criteria: this.criteria,
        evaluation,
        timestamp: Date.now()
      });
    } else {
      this.logger.info('Reactivation criteria not yet met', {
        evaluation,
        missing: evaluation.missingCriteria
      });
    }
  }
  
  private evaluateCriteria(): {
    ready: boolean;
    missingCriteria: string[];
    warnings: string[];
    score: number; // 0-100
  } {
    const missing: string[] = [];
    const warnings: string[] = [];
    let score = 0;
    
    // Backtest validation (25 points)
    if (!this.criteria.backtestPassed) {
      missing.push('Backtest validation not passed');
    } else {
      score += 25;
      if (this.criteria.backtestResults) {
        if (this.criteria.backtestResults.passRate < this.REQUIRED_BACKTEST_PASS_RATE) {
          warnings.push(`Backtest pass rate only ${(this.criteria.backtestResults.passRate * 100).toFixed(1)}%`);
        }
      }
    }
    
    // Paper trading Sharpe (25 points)
    if (this.criteria.paperTradingSharpe < this.REQUIRED_SHARPE) {
      missing.push(
        `Paper trading Sharpe ratio (${this.criteria.paperTradingSharpe.toFixed(2)}) < ${this.REQUIRED_SHARPE}`
      );
    } else {
      score += 25;
      if (this.criteria.paperTradingSharpe < this.REQUIRED_SHARPE * 1.2) {
        warnings.push('Paper trading Sharpe is only marginally above threshold');
      }
    }
    
    // Paper trading duration (25 points)
    if (this.criteria.paperTradingDays < this.REQUIRED_PAPER_DAYS) {
      missing.push(
        `Only ${this.criteria.paperTradingDays} days of paper trading (${this.REQUIRED_PAPER_DAYS} required)`
      );
    } else {
      score += 25;
    }
    
    // Chaos tests (25 points)
    if (!this.criteria.chaosTestsPassed) {
      missing.push('Chaos tests not passed');
    } else {
      score += 25;
      if (this.criteria.chaosTestResults) {
        if (this.criteria.chaosTestResults.recoveryRate < this.REQUIRED_CHAOS_RECOVERY) {
          warnings.push(
            `Chaos recovery rate only ${(this.criteria.chaosTestResults.recoveryRate * 100).toFixed(1)}%`
          );
        }
      }
    }
    
    // Bonus points for manual approval
    if (this.criteria.manualApproval?.approved) {
      score = Math.min(100, score + 10);
    }
    
    const ready = missing.length === 0;
    
    return { ready, missingCriteria: missing, warnings, score };
  }
  
  public async requestReactivation(
    requestedBy: string,
    notes?: string
  ): Promise<{
    success: boolean;
    reason?: string;
    evaluation?: any;
  }> {
    this.logger.warn(`⚡ Live trading reactivation requested by ${requestedBy}`);
    
    // Evaluate current criteria
    const evaluation = this.evaluateCriteria();
    
    // Create attempt record
    const attempt: ReactivationAttempt = {
      timestamp: new Date(),
      requestedBy,
      criteria: { ...this.criteria },
      result: 'rejected',
      reason: ''
    };
    
    // Check if all criteria are met
    if (!evaluation.ready) {
      attempt.reason = `Criteria not met: ${evaluation.missingCriteria.join(', ')}`;
      this.logger.error('❌ Reactivation rejected - criteria not met', {
        requestedBy,
        missing: evaluation.missingCriteria,
        score: evaluation.score
      });
      
      this.reactivationAttempts.push(attempt);
      this.emit('reactivation-rejected', attempt);
      
      return {
        success: false,
        reason: attempt.reason,
        evaluation
      };
    }
    
    // Check for warnings
    if (evaluation.warnings.length > 0) {
      this.logger.warn('⚠️  Reactivation has warnings', evaluation.warnings);
    }
    
    // Check for manual approval
    if (!this.criteria.manualApproval?.approved) {
      attempt.reason = 'Manual approval required';
      this.logger.warn('🔐 Awaiting manual approval for reactivation');
      
      this.emit('manual-approval-required', {
        requestedBy,
        evaluation,
        notes
      });
      
      this.reactivationAttempts.push(attempt);
      
      return {
        success: false,
        reason: attempt.reason,
        evaluation
      };
    }
    
    // All criteria met - attempt reactivation
    this.logger.info('✅ All reactivation criteria satisfied, attempting mode change...');
    
    const reactivated = await this.safetyController.setTradingMode(
      'LIVE',
      `Reactivation criteria met (score: ${evaluation.score}/100)`,
      requestedBy,
      [this.criteria.manualApproval.approvedBy] // Include approver as signature
    );
    
    if (reactivated) {
      attempt.result = 'approved';
      this.logger.info('🎉 LIVE TRADING SUCCESSFULLY REACTIVATED!', {
        requestedBy,
        score: evaluation.score,
        approvedBy: this.criteria.manualApproval.approvedBy
      });
      
      this.emit('live-trading-reactivated', {
        timestamp: Date.now(),
        criteria: this.criteria,
        evaluation,
        activatedBy: requestedBy
      });
      
      // Append to audit log
      this.appendToAuditLog('REACTIVATION_SUCCESS', {
        requestedBy,
        evaluation,
        criteria: this.criteria
      });
      
      // Reset criteria for next cycle
      this.resetCriteria();
      
      this.reactivationAttempts.push(attempt);
      
      return { success: true, evaluation };
    } else {
      attempt.reason = 'Safety controller rejected reactivation';
      this.logger.error('❌ Safety controller rejected reactivation');
      
      this.reactivationAttempts.push(attempt);
      
      return {
        success: false,
        reason: attempt.reason,
        evaluation
      };
    }
  }
  
  public async provideManualApproval(
    approvedBy: string,
    notes?: string
  ): Promise<void> {
    this.criteria.manualApproval = {
      approved: true,
      approvedBy,
      timestamp: new Date(),
      notes
    };
    
    this.logger.info(`✍️  Manual approval provided by ${approvedBy}`, { notes });
    
    // Persist immediately
    this.persistCriteria();
    
    // Append to audit log
    this.appendToAuditLog('MANUAL_APPROVAL', {
      approvedBy,
      notes,
      currentCriteria: this.getCriteriaSummary()
    });
    
    // Check if we're now ready
    this.checkReactivationReadiness();
    
    // Emit approval event
    this.emit('manual-approval-granted', {
      approvedBy,
      notes,
      timestamp: Date.now()
    });
  }
  
  public revokeManualApproval(reason: string): void {
    if (this.criteria.manualApproval) {
      this.logger.warn('🚫 Manual approval revoked', { reason });
      
      this.criteria.manualApproval = undefined;
      this.persistCriteria();
      
      this.emit('manual-approval-revoked', { reason });
    }
  }
  
  private resetCriteria(): void {
    this.logger.info('Resetting reactivation criteria for next cycle');
    
    this.criteria = {
      backtestPassed: false,
      paperTradingSharpe: 0,
      paperTradingDays: 0,
      chaosTestsPassed: false,
      manualApproval: undefined
    };
    
    this.persistCriteria();
  }
  
  public getCriteria(): ReactivationCriteria {
    return { ...this.criteria };
  }
  
  public getReactivationHistory(): ReactivationAttempt[] {
    return [...this.reactivationAttempts];
  }
  
  private getCriteriaSummary(criteria?: ReactivationCriteria): any {
    const c = criteria || this.criteria;
    return {
      backtest: c.backtestPassed ? '✅' : '❌',
      sharpe: c.paperTradingSharpe.toFixed(2),
      days: c.paperTradingDays,
      chaos: c.chaosTestsPassed ? '✅' : '❌',
      manual: c.manualApproval?.approved ? '✅' : '❌'
    };
  }
  
  private appendToAuditLog(event: string, data: any): void {
    const auditPath = path.join(process.cwd(), 'SAFETY_AUDIT_LOG.jsonl');
    const auditEntry = {
      type: event,
      timestamp: new Date().toISOString(),
      ...data
    };
    fs.appendFileSync(auditPath, JSON.stringify(auditEntry) + '\n');
  }
  
  // Status report generation
  public getStatusReport(): string {
    const evaluation = this.evaluateCriteria();
    const status = this.getCriteriaSummary();
    
    const lines = [
      '╔════════════════════════════════════════╗',
      '║    LIVE TRADING REACTIVATION STATUS    ║',
      '╠════════════════════════════════════════╣',
      `║ Overall Score: ${evaluation.score}/100${' '.repeat(23 - evaluation.score.toString().length)} ║`,
      `║ Status: ${evaluation.ready ? 'READY ✅' : 'NOT READY ❌'}${' '.repeat(evaluation.ready ? 22 : 18)} ║`,
      '╠════════════════════════════════════════╣',
      '║ CRITERIA                               ║',
      '╠════════════════════════════════════════╣',
      `║ ${status.backtest} Backtest Validation${' '.repeat(19)} ║`,
      `║ ${status.sharpe >= this.REQUIRED_SHARPE ? '✅' : '❌'} Paper Sharpe: ${status.sharpe} (≥${this.REQUIRED_SHARPE})${' '.repeat(11 - status.sharpe.length)} ║`,
      `║ ${status.days >= this.REQUIRED_PAPER_DAYS ? '✅' : '❌'} Paper Days: ${status.days} (≥${this.REQUIRED_PAPER_DAYS})${' '.repeat(14 - status.days.toString().length)} ║`,
      `║ ${status.chaos} Chaos Tests${' '.repeat(25)} ║`,
      `║ ${status.manual} Manual Approval${' '.repeat(21)} ║`,
      '╚════════════════════════════════════════╝'
    ];
    
    if (evaluation.missingCriteria.length > 0) {
      lines.push('');
      lines.push('Missing Criteria:');
      evaluation.missingCriteria.forEach(m => lines.push(`  • ${m}`));
    }
    
    if (evaluation.warnings.length > 0) {
      lines.push('');
      lines.push('Warnings:');
      evaluation.warnings.forEach(w => lines.push(`  ⚠️  ${w}`));
    }
    
    if (this.criteria.manualApproval?.approved) {
      lines.push('');
      lines.push(`Manual Approval: ${this.criteria.manualApproval.approvedBy} (${new Date(this.criteria.manualApproval.timestamp).toLocaleDateString()})`);
      if (this.criteria.manualApproval.notes) {
        lines.push(`Notes: ${this.criteria.manualApproval.notes}`);
      }
    }
    
    return lines.join('\n');
  }
} 