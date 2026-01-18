import { Logger } from '.';
import { EventEmitter } from 'events';

const logger = new Logger('DeadMansSwitch');
const createLogger = (name: string) => ({
  info: (message: string, meta?: any) => logger.info(`[${name}] INFO: ${message}`, meta),
  error: (message: string, error?: any) => logger.error(`[${name}] ERROR: ${message}`, error),
  debug: (message: string, meta?: any) => logger.debug(`[${name}] DEBUG: ${message}`, meta),
  warn: (message: string, meta?: any) => logger.warn(`[${name}] WARN: ${message}`, meta)
});

export interface DeadMansSwitchConfig {
  name: string;
  timeoutMs: number;
  warningThresholdMs?: number;
  maxMissedBeats?: number;
  autoRecover?: boolean;
  action: () => Promise<void>;
  warningAction?: () => Promise<void>;
}

export interface SwitchStatus {
  name: string;
  active: boolean;
  lastHeartbeat: Date | null;
  missedBeats: number;
  triggered: boolean;
  triggerCount: number;
  timeUntilTrigger: number;
  warningIssued: boolean;
}

export class DeadMansSwitch extends EventEmitter {
  private logger: ReturnType<typeof createLogger>;
  private config: DeadMansSwitchConfig;
  private timer?: NodeJS.Timeout;
  private warningTimer?: NodeJS.Timeout;
  private lastHeartbeat: Date | null = null;
  private missedBeats: number = 0;
  private triggered: boolean = false;
  private triggerCount: number = 0;
  private warningIssued: boolean = false;
  private active: boolean = false;
  
  constructor(config: DeadMansSwitchConfig) {
    super();
    this.logger = createLogger(`DeadMansSwitch:${config.name}`);
    this.config = {
      maxMissedBeats: 3,
      autoRecover: true,
      ...config
    };
    
    this.logger.info('Dead man\'s switch initialized', {
      name: config.name,
      timeoutMs: config.timeoutMs,
      warningThresholdMs: config.warningThresholdMs
    });
  }
  
  /**
   * Start the dead man's switch
   */
  public start(): void {
    if (this.active) {
      this.logger.warn('Dead man\'s switch already active');
      return;
    }
    
    this.active = true;
    this.lastHeartbeat = new Date();
    this.missedBeats = 0;
    this.triggered = false;
    this.warningIssued = false;
    
    this.scheduleTimeout();
    
    this.logger.info('Dead man\'s switch started');
    this.emit('started', { name: this.config.name });
  }
  
  /**
   * Stop the dead man's switch
   */
  public stop(): void {
    if (!this.active) {
      return;
    }
    
    this.active = false;
    
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    
    if (this.warningTimer) {
      clearTimeout(this.warningTimer);
      this.warningTimer = undefined;
    }
    
    this.logger.info('Dead man\'s switch stopped');
    this.emit('stopped', { name: this.config.name });
  }
  
  /**
   * Send a heartbeat to reset the timer
   */
  public heartbeat(metadata?: any): void {
    if (!this.active) {
      this.logger.warn('Heartbeat received but switch is not active');
      return;
    }
    
    const previousHeartbeat = this.lastHeartbeat;
    this.lastHeartbeat = new Date();
    
    // Calculate time since last heartbeat
    const timeSinceLastMs = previousHeartbeat 
      ? this.lastHeartbeat.getTime() - previousHeartbeat.getTime()
      : 0;
    
    // Reset missed beats
    if (this.missedBeats > 0) {
      this.logger.info(`Heartbeat received after ${this.missedBeats} missed beats`);
      this.missedBeats = 0;
    }
    
    // Clear warning state
    if (this.warningIssued) {
      this.warningIssued = false;
      this.logger.info('Warning state cleared');
    }
    
    // Reset timers
    this.resetTimers();
    this.scheduleTimeout();
    
    this.emit('heartbeat', {
      name: this.config.name,
      timestamp: this.lastHeartbeat,
      timeSinceLastMs,
      metadata
    });
    
    // If we were triggered and auto-recover is enabled, reset
    if (this.triggered && this.config.autoRecover) {
      this.triggered = false;
      this.logger.info('Auto-recovered from triggered state');
      this.emit('recovered', {
        name: this.config.name,
        triggerCount: this.triggerCount
      });
    }
  }
  
  /**
   * Get current status
   */
  public getStatus(): SwitchStatus {
    const timeUntilTrigger = this.getTimeUntilTrigger();
    
    return {
      name: this.config.name,
      active: this.active,
      lastHeartbeat: this.lastHeartbeat,
      missedBeats: this.missedBeats,
      triggered: this.triggered,
      triggerCount: this.triggerCount,
      timeUntilTrigger,
      warningIssued: this.warningIssued
    };
  }
  
  /**
   * Force trigger the switch manually
   */
  public async forceTrigger(reason: string): Promise<void> {
    this.logger.warn(`Force triggering dead man's switch: ${reason}`);
    await this.trigger('MANUAL', reason);
  }
  
  /**
   * Update configuration
   */
  public updateConfig(updates: Partial<DeadMansSwitchConfig>): void {
    const oldTimeout = this.config.timeoutMs;
    this.config = { ...this.config, ...updates };
    
    // If timeout changed and switch is active, restart timers
    if (this.active && this.config.timeoutMs !== oldTimeout) {
      this.resetTimers();
      this.scheduleTimeout();
    }
    
    this.logger.info('Configuration updated', updates);
    this.emit('config-updated', this.config);
  }
  
  // Private methods
  
  private scheduleTimeout(): void {
    // Schedule warning if configured
    if (this.config.warningThresholdMs && this.config.warningThresholdMs < this.config.timeoutMs) {
      this.warningTimer = setTimeout(() => {
        this.issueWarning();
      }, this.config.warningThresholdMs);
    }
    
    // Schedule main timeout
    this.timer = setTimeout(() => {
      this.handleTimeout();
    }, this.config.timeoutMs);
  }
  
  private resetTimers(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    
    if (this.warningTimer) {
      clearTimeout(this.warningTimer);
      this.warningTimer = undefined;
    }
  }
  
  private async issueWarning(): Promise<void> {
    if (!this.active || this.warningIssued) {
      return;
    }
    
    this.warningIssued = true;
    const timeRemaining = this.config.timeoutMs - (this.config.warningThresholdMs || 0);
    
    this.logger.warn(`Warning: Dead man's switch will trigger in ${timeRemaining}ms`);
    
    this.emit('warning', {
      name: this.config.name,
      timeRemainingMs: timeRemaining
    });
    
    // Execute warning action if configured
    if (this.config.warningAction) {
      try {
        await this.config.warningAction();
      } catch (error) {
        this.logger.error('Warning action failed', error);
      }
    }
  }
  
  private async handleTimeout(): Promise<void> {
    if (!this.active) {
      return;
    }
    
    this.missedBeats++;
    
    this.logger.warn(`Heartbeat missed (${this.missedBeats}/${this.config.maxMissedBeats})`);
    
    this.emit('missed-beat', {
      name: this.config.name,
      missedBeats: this.missedBeats,
      maxMissedBeats: this.config.maxMissedBeats
    });
    
    // Check if we should trigger
    if (this.missedBeats >= (this.config.maxMissedBeats || 3)) {
      await this.trigger('TIMEOUT', `No heartbeat for ${this.config.timeoutMs * this.missedBeats}ms`);
    } else {
      // Schedule next timeout
      this.scheduleTimeout();
    }
  }
  
  private async trigger(type: 'TIMEOUT' | 'MANUAL', reason: string): Promise<void> {
    if (this.triggered && !this.config.autoRecover) {
      this.logger.warn('Dead man\'s switch already triggered (no auto-recover)');
      return;
    }
    
    this.triggered = true;
    this.triggerCount++;
    
    this.logger.error(`🚨 DEAD MAN'S SWITCH TRIGGERED: ${reason}`);
    
    this.emit('triggered', {
      name: this.config.name,
      type,
      reason,
      timestamp: new Date(),
      triggerCount: this.triggerCount,
      missedBeats: this.missedBeats
    });
    
    // Execute the configured action
    try {
      this.logger.info('Executing dead man\'s switch action...');
      await this.config.action();
      this.logger.info('Dead man\'s switch action completed');
      
      this.emit('action-completed', {
        name: this.config.name,
        success: true
      });
      
    } catch (error: unknown) {
      this.logger.error('Dead man\'s switch action failed', error);
      
      this.emit('action-failed', {
        name: this.config.name,
        error: error.message
      });
    }
    
    // Reset timers if auto-recover is enabled
    if (this.config.autoRecover && this.active) {
      this.resetTimers();
      this.scheduleTimeout();
    } else {
      // Stop the switch
      this.stop();
    }
  }
  
  private getTimeUntilTrigger(): number {
    if (!this.active || !this.lastHeartbeat) {
      return 0;
    }
    
    const timeSinceLastHeartbeat = Date.now() - this.lastHeartbeat.getTime();
    const remainingBeats = (this.config.maxMissedBeats || 3) - this.missedBeats;
    const timeUntilNextBeat = Math.max(0, this.config.timeoutMs - timeSinceLastHeartbeat);
    
    return timeUntilNextBeat + ((remainingBeats - 1) * this.config.timeoutMs);
  }
  
  /**
   * Destroy and clean up
   */
  public destroy(): void {
    this.stop();
    this.removeAllListeners();
    this.logger.info('Dead man\'s switch destroyed');
  }
} 