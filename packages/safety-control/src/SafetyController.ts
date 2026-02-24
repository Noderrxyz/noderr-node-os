import { Logger } from '@noderr/utils';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

const logger = new Logger('SafetyController');
const createLogger = (name: string) => ({
  info: (message: string, meta?: any) => logger.info(`[${name}] INFO: ${message}`, meta),
  error: (message: string, error?: any) => logger.error(`[${name}] ERROR: ${message}`, error),
  debug: (message: string, meta?: any) => logger.debug(`[${name}] DEBUG: ${message}`, meta),
  warn: (message: string, meta?: any) => logger.warn(`[${name}] WARN: ${message}`, meta)
});

export type TradingMode = 'SIMULATION' | 'PAUSED' | 'LIVE';

interface ModeChangeEvent {
  previousMode: TradingMode;
  newMode: TradingMode;
  reason: string;
  timestamp: number;
  authorizedBy?: string;
  approvalSignatures?: string[];
}

interface SafetyCheck {
  name: string;
  check: () => Promise<boolean>;
  critical: boolean;
  description?: string;
}

interface SafetyState {
  mode: TradingMode;
  lastChange: ModeChangeEvent | null;
  timestamp: number;
  checksum: string;
}

export class SafetyController extends EventEmitter {
  private static instance: SafetyController;
  private logger: ReturnType<typeof createLogger>;
  private tradingMode: TradingMode = 'SIMULATION';
  private modeHistory: ModeChangeEvent[] = [];
  private safetyChecks: SafetyCheck[] = [];
  private lockFilePath: string = '.trading-mode.lock';
  private encryptedLockPath: string = '.trading-mode.lock.enc';
  private encryptionKey: Buffer;
  
  private constructor() {
    super();
    this.logger = createLogger('SafetyController');
    
    // Generate or load encryption key
    this.encryptionKey = this.loadOrGenerateEncryptionKey();
    
    // Load persisted mode
    this.loadPersistedMode();
    
    // Setup default safety checks
    this.setupDefaultSafetyChecks();
    
    // Log initialization
    this.logger.warn(`🔐 SafetyController initialized in ${this.tradingMode} mode`);
  }
  
  public static getInstance(): SafetyController {
    if (!SafetyController.instance) {
      SafetyController.instance = new SafetyController();
    }
    return SafetyController.instance;
  }
  
  private loadOrGenerateEncryptionKey(): Buffer {
    const keyPath = path.join(process.cwd(), '.safety-key');
    
    if (fs.existsSync(keyPath)) {
      return fs.readFileSync(keyPath);
    } else {
      const key = crypto.randomBytes(32);
      fs.writeFileSync(keyPath, key);
      this.logger.info('Generated new encryption key for safety state');
      return key;
    }
  }
  
  private loadPersistedMode(): void {
    try {
      // Try loading encrypted file first
      if (fs.existsSync(this.encryptedLockPath)) {
        const encrypted = fs.readFileSync(this.encryptedLockPath);
        const decrypted = this.decryptState(encrypted);
        const state: SafetyState = JSON.parse(decrypted);
        
        // Verify checksum
        if (this.verifyChecksum(state)) {
          this.tradingMode = state.mode || 'SIMULATION';
          if (state.lastChange) {
            this.modeHistory.push(state.lastChange);
          }
          this.logger.info(`Loaded encrypted trading mode: ${this.tradingMode}`);
          return;
        } else {
          this.logger.error('Checksum verification failed, defaulting to SIMULATION');
        }
      }
      
      // Fallback to unencrypted file
      if (fs.existsSync(this.lockFilePath)) {
        const lockData = JSON.parse(fs.readFileSync(this.lockFilePath, 'utf8'));
        this.tradingMode = lockData.mode || 'SIMULATION';
        this.logger.info(`Loaded persisted trading mode: ${this.tradingMode}`);
      }
    } catch (error) {
      this.logger.error('Failed to load persisted mode, defaulting to SIMULATION', error);
      this.tradingMode = 'SIMULATION';
    }
  }
  
  private setupDefaultSafetyChecks(): void {
    // Environment check
    this.addSafetyCheck({
      name: 'Environment Configuration',
      description: 'Verify ENABLE_LIVE_TRADING flag is set',
      check: async () => {
        const enabled = process.env.ENABLE_LIVE_TRADING === 'true';
        if (!enabled) {
          this.logger.warn('ENABLE_LIVE_TRADING is not true');
        }
        return enabled;
      },
      critical: true
    });
    
    // API Keys check
    this.addSafetyCheck({
      name: 'API Keys Validation',
      description: 'Ensure exchange API keys are configured',
      check: async () => {
        const hasKeys = !!(
          process.env.BINANCE_API_KEY && 
          process.env.BINANCE_API_SECRET &&
          process.env.COINBASE_API_KEY && 
          process.env.COINBASE_API_SECRET
        );
        if (!hasKeys) {
          this.logger.warn('Missing exchange API keys');
        }
        return this.tradingMode !== 'LIVE' || hasKeys;
      },
      critical: true
    });
    
    // Database connectivity
    this.addSafetyCheck({
      name: 'Database Connectivity',
      description: 'Verify database is accessible',
      check: async () => {
        // In production, would actually test DB connection
        const dbConfigured = !!(process.env.DB_HOST && process.env.DB_PASSWORD);
        return dbConfigured;
      },
      critical: false
    });
    
    // Risk limits configured
    this.addSafetyCheck({
      name: 'Risk Limits Configuration',
      description: 'Ensure risk parameters are set',
      check: async () => {
        const hasLimits = !!(
          process.env.MAX_DRAWDOWN && 
          process.env.DAILY_LOSS_LIMIT &&
          process.env.MAX_POSITION_SIZE
        );
        return hasLimits;
      },
      critical: true
    });
  }
  
  public async setTradingMode(
    mode: TradingMode, 
    reason: string, 
    authorizedBy?: string,
    approvalSignatures?: string[]
  ): Promise<boolean> {
    const previousMode = this.tradingMode;
    
    // Don't change if already in requested mode
    if (previousMode === mode) {
      this.logger.info(`Already in ${mode} mode`);
      return true;
    }
    
    // Log mode change attempt
    this.logger.warn(`🔄 Trading mode change requested: ${previousMode} → ${mode}`, {
      reason,
      authorizedBy,
      timestamp: new Date().toISOString()
    });
    
    // Run safety checks before enabling LIVE mode
    if (mode === 'LIVE') {
      const safetyResult = await this.runSafetyChecks();
      if (!safetyResult.passed) {
        this.logger.error('❌ Safety checks failed, cannot enable LIVE mode', {
          failedChecks: safetyResult.failedChecks
        });
        this.emit('mode-change-rejected', {
          requestedMode: mode,
          reason: 'Safety checks failed',
          failedChecks: safetyResult.failedChecks,
          timestamp: Date.now()
        });
        return false;
      }
      
      // Additional warning for LIVE mode
      this.logger.warn('⚠️  ENABLING LIVE TRADING MODE - REAL MONEY AT RISK');
    }
    
    // Update mode
    this.tradingMode = mode;
    
    // Create change event
    const changeEvent: ModeChangeEvent = {
      previousMode,
      newMode: mode,
      reason,
      timestamp: Date.now(),
      authorizedBy,
      approvalSignatures
    };
    
    // Persist to both encrypted and plain files
    this.persistMode(changeEvent);
    
    // Add to history
    this.modeHistory.push(changeEvent);
    
    // Log change with appropriate severity
    const logMessage = `🔐 TRADING MODE CHANGED: ${previousMode} → ${mode}`;
    if (mode === 'LIVE') {
      this.logger.error(logMessage, changeEvent); // Use error level for visibility
    } else {
      this.logger.warn(logMessage, changeEvent);
    }
    
    // Emit change event
    this.emit('mode-changed', changeEvent);
    
    // If changing away from LIVE, emit safety event
    if (previousMode === 'LIVE' && mode !== 'LIVE') {
      this.emit('live-trading-disabled', changeEvent);
    }
    
    return true;
  }
  
  private persistMode(event: ModeChangeEvent): void {
    try {
      const state: SafetyState = {
        mode: this.tradingMode,
        lastChange: event,
        timestamp: Date.now(),
        checksum: ''
      };
      
      // Calculate checksum
      state.checksum = this.calculateChecksum(state);
      
      // Save encrypted version
      const encrypted = this.encryptState(JSON.stringify(state));
      fs.writeFileSync(this.encryptedLockPath, encrypted);
      
      // Also save plain version for debugging
      fs.writeFileSync(this.lockFilePath, JSON.stringify(state, null, 2));
      
      // Append to audit log
      this.appendToAuditLog(event);
      
    } catch (error) {
      this.logger.error('Failed to persist mode', error);
    }
  }
  
  private encryptState(data: string): Buffer {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', this.encryptionKey, iv);
    const encrypted = Buffer.concat([cipher.update(data, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, encrypted]);
  }
  
  private decryptState(data: Buffer): string {
    const iv = data.slice(0, 16);
    const encrypted = data.slice(16);
    const decipher = crypto.createDecipheriv('aes-256-cbc', this.encryptionKey, iv);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted.toString('utf8');
  }
  
  private calculateChecksum(state: SafetyState): string {
    const data = `${state.mode}-${state.timestamp}-${state.lastChange?.timestamp || 0}`;
    return crypto.createHash('sha256').update(data).digest('hex');
  }
  
  private verifyChecksum(state: SafetyState): boolean {
    const calculated = this.calculateChecksum({ ...state, checksum: '' });
    return calculated === state.checksum;
  }
  
  private appendToAuditLog(event: ModeChangeEvent): void {
    const auditPath = path.join(process.cwd(), 'SAFETY_AUDIT_LOG.jsonl');
    const auditEntry = {
      ...event,
      type: 'MODE_CHANGE',
      systemTime: new Date().toISOString()
    };
    fs.appendFileSync(auditPath, JSON.stringify(auditEntry) + '\n');
  }
  
  public getTradingMode(): TradingMode {
    return this.tradingMode;
  }
  
  public canExecuteLiveTrade(): boolean {
    const canTrade = this.tradingMode === 'LIVE' && process.env.ENABLE_LIVE_TRADING === 'true';
    
    if (!canTrade && this.tradingMode === 'LIVE') {
      this.logger.warn('Live mode enabled but ENABLE_LIVE_TRADING is not true');
    }
    
    return canTrade;
  }
  
  public isSimulationMode(): boolean {
    return this.tradingMode === 'SIMULATION';
  }
  
  public isPaused(): boolean {
    return this.tradingMode === 'PAUSED';
  }
  
  public addSafetyCheck(check: SafetyCheck): void {
    this.safetyChecks.push(check);
    this.logger.debug(`Added safety check: ${check.name}`);
  }
  
  public async runSafetyChecks(): Promise<{ passed: boolean; failedChecks: string[] }> {
    this.logger.info('Running safety checks...');
    const failedChecks: string[] = [];
    let criticalFailure = false;
    
    for (const check of this.safetyChecks) {
      try {
        const passed = await check.check();
        if (!passed) {
          failedChecks.push(check.name);
          this.logger.warn(`Safety check failed: ${check.name}`);
          if (check.critical) {
            criticalFailure = true;
          }
        } else {
          this.logger.debug(`Safety check passed: ${check.name}`);
        }
      } catch (error) {
        this.logger.error(`Safety check error: ${check.name}`, error);
        failedChecks.push(check.name);
        if (check.critical) {
          criticalFailure = true;
        }
      }
    }
    
    const passed = !criticalFailure && failedChecks.length === 0;
    this.logger.info(`Safety checks complete: ${passed ? 'PASSED' : 'FAILED'}`);
    
    return { passed, failedChecks };
  }
  
  public getModeHistory(): ModeChangeEvent[] {
    return [...this.modeHistory];
  }
  
  public getLastModeChange(): ModeChangeEvent | undefined {
    return this.modeHistory[this.modeHistory.length - 1];
  }
  
  public getSafetyStatus(): {
    mode: TradingMode;
    isLiveEnabled: boolean;
    lastChange: ModeChangeEvent | undefined;
    uptime: number;
    checksConfigured: number;
  } {
    const startTime = this.getLastModeChange()?.timestamp || Date.now();
    
    return {
      mode: this.tradingMode,
      isLiveEnabled: this.canExecuteLiveTrade(),
      lastChange: this.getLastModeChange(),
      uptime: Date.now() - startTime,
      checksConfigured: this.safetyChecks.length
    };
  }
  
  // Emergency stop function
  public async emergencyStop(reason: string): Promise<void> {
    this.logger.error(`🚨 EMERGENCY STOP TRIGGERED: ${reason}`);
    
    // Immediately switch to PAUSED mode
    await this.setTradingMode('PAUSED', `EMERGENCY: ${reason}`, 'SYSTEM');
    
    // Emit emergency event
    this.emit('emergency-stop', { 
      reason, 
      timestamp: Date.now(),
      previousMode: this.tradingMode
    });
    
    // Log to audit
    this.appendToAuditLog({
      previousMode: this.tradingMode,
      newMode: 'PAUSED',
      reason: `EMERGENCY STOP: ${reason}`,
      timestamp: Date.now(),
      authorizedBy: 'SYSTEM'
    });
  }
  
  // CLI command support
  public getCliStatus(): string {
    const status = this.getSafetyStatus();
    const lines = [
      '╔════════════════════════════════════════╗',
      '║        SAFETY CONTROLLER STATUS        ║',
      '╠════════════════════════════════════════╣',
      `║ Mode: ${status.mode.padEnd(32)} ║`,
      `║ Live Trading: ${(status.isLiveEnabled ? 'ENABLED' : 'DISABLED').padEnd(24)} ║`,
      `║ Safety Checks: ${String(status.checksConfigured).padEnd(23)} ║`,
      `║ Uptime: ${this.formatUptime(status.uptime).padEnd(30)} ║`,
      '╚════════════════════════════════════════╝'
    ];
    
    if (status.lastChange) {
      lines.push('');
      lines.push(`Last Change: ${new Date(status.lastChange.timestamp).toISOString()}`);
      lines.push(`Reason: ${status.lastChange.reason}`);
      lines.push(`Authorized By: ${status.lastChange.authorizedBy || 'Unknown'}`);
    }
    
    return lines.join('\n');
  }
  
  private formatUptime(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (days > 0) return `${days}d ${hours % 24}h`;
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  }
} 