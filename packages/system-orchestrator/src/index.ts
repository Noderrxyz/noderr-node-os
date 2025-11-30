/**
 * SystemOrchestrator - Main entry point for the Noderr Protocol
 * 
 * Integrates all modules for local testing and production deployment
 */

import { EventEmitter } from 'events';
import { SafetyController, TradingMode } from '../../safety-control/src/SafetyController';
import { AlphaOrchestrator } from '../../alpha-orchestrator/src/AlphaOrchestrator';
import { UnifiedCapitalManager } from '../../capital-management/src/UnifiedCapitalManager';
import { ExecutionOptimizerService } from '../../execution-optimizer/src/services/ExecutionOptimizerService';
import { StrategyPerformanceRegistry } from '../../performance-registry/src/StrategyPerformanceRegistry';
import { BinanceConnector } from '../../data-connectors/src/BinanceConnector';
import { CoinbaseConnector } from '../../data-connectors/src/CoinbaseConnector';
import { SignalSource, SignalType } from '../../alpha-orchestrator/src/types';
import { StrategyType, StrategyStatus } from '../../performance-registry/src/types';
import { createDefaultConfig } from '../../execution-optimizer/src';
import * as winston from 'winston';

const createLogger = (name: string): winston.Logger => {
  return winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.errors({ stack: true }),
      winston.format.printf(({ timestamp, level, message, ...meta }) => {
        const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
        return `[${timestamp}] [${name}] ${level.toUpperCase()}: ${message}${metaStr}`;
      })
    ),
    transports: [
      new winston.transports.Console({
        format: winston.format.colorize({ all: true })
      })
    ]
  });
};

export interface SystemConfig {
  mode: 'local' | 'staging' | 'production';
  tradingMode: TradingMode;
  initialCapital: number;
  dataConnectors: {
    binance?: {
      enabled: boolean;
      apiKey?: string;
      apiSecret?: string;
      testnet?: boolean;
      symbols: string[];
    };
    coinbase?: {
      enabled: boolean;
      apiKey?: string;
      apiSecret?: string;
      passphrase?: string;
      sandbox?: boolean;
      symbols: string[];
    };
  };
  strategies: {
    enabled: string[];
    config: Record<string, any>;
  };
}

export class SystemOrchestrator extends EventEmitter {
  private logger: winston.Logger;
  private config: SystemConfig;
  
  // Core modules
  private safetyController: SafetyController;
  private alphaOrchestrator: AlphaOrchestrator;
  private capitalManager: UnifiedCapitalManager;
  private executionOptimizer: ExecutionOptimizerService;
  private performanceRegistry: StrategyPerformanceRegistry;
  
  // Data connectors
  private binanceConnector?: BinanceConnector;
  private coinbaseConnector?: CoinbaseConnector;
  
  // System state
  private isRunning: boolean = false;
  private startTime?: number;
  
  constructor(config: SystemConfig) {
    super();
    this.logger = createLogger('SystemOrchestrator');
    this.config = config;
    
    // Initialize core modules
    this.safetyController = SafetyController.getInstance();
    this.alphaOrchestrator = AlphaOrchestrator.getInstance();
    this.capitalManager = UnifiedCapitalManager.getInstance();
    
    // Create execution optimizer with default config
    const executionConfig = createDefaultConfig();
    this.executionOptimizer = new ExecutionOptimizerService(
      executionConfig,
      createLogger('ExecutionOptimizer')
    );
    
    this.performanceRegistry = StrategyPerformanceRegistry.getInstance();
    
    this.logger.info('System Orchestrator initialized', {
      mode: config.mode,
      tradingMode: config.tradingMode
    });
  }
  
  /**
   * Initialize and start the system
   */
  public async start(): Promise<void> {
    if (this.isRunning) {
      throw new Error('System is already running');
    }
    
    this.logger.info('Starting Noderr Protocol...', {
      mode: this.config.mode,
      tradingMode: this.config.tradingMode
    });
    
    try {
      // 1. Set trading mode
      await this.safetyController.setTradingMode(
        this.config.tradingMode,
        `System initialization in ${this.config.mode} mode`,
        'SYSTEM'
      );
      this.logger.info(`Trading mode set to: ${this.config.tradingMode}`);
      
      // 2. Initialize capital
      await this.capitalManager.initializeCapital(this.config.initialCapital);
      this.logger.info(`Capital initialized: $${this.config.initialCapital.toLocaleString()}`);
      
      // 3. Initialize data connectors
      await this.initializeDataConnectors();
      
      // 4. Initialize execution optimizer
      await this.initializeExecutionOptimizer();
      
      // 5. Register strategies
      await this.registerStrategies();
      
      // 6. Set up event listeners
      this.setupEventListeners();
      
      // 7. Start data feeds
      await this.startDataFeeds();
      
      this.isRunning = true;
      this.startTime = Date.now();
      
      this.logger.info('✅ Noderr Protocol started successfully', {
        uptime: 0,
        modules: {
          safety: 'active',
          alpha: 'active',
          capital: 'active',
          execution: 'active',
          performance: 'active'
        }
      });
      
      this.emit('system-started', {
        timestamp: this.startTime,
        config: this.config
      });
      
    } catch (error) {
      this.logger.error('Failed to start system', error);
      throw error;
    }
  }
  
  /**
   * Initialize data connectors
   */
  private async initializeDataConnectors(): Promise<void> {
    const { binance, coinbase } = this.config.dataConnectors;
    
    // For local testing, skip actual WebSocket connections
    if (this.config.mode === 'local') {
      this.logger.info('Local mode: Using mock data connectors');
      
      // Create mock market data generator
      this.startMockMarketData();
      return;
    }
    
    if (binance?.enabled) {
      this.binanceConnector = new BinanceConnector({
        name: 'binance',
        url: binance.testnet 
          ? 'wss://testnet.binance.vision' 
          : 'wss://stream.binance.com:9443',
        apiKey: binance.apiKey,
        apiSecret: binance.apiSecret,
        symbols: binance.symbols
      });
      
      await this.binanceConnector.connect();
      this.logger.info('Binance connector initialized', {
        symbols: binance.symbols,
        testnet: binance.testnet
      });
    }
    
    if (coinbase?.enabled) {
      this.coinbaseConnector = new CoinbaseConnector({
        name: 'coinbase',
        url: coinbase.sandbox
          ? 'wss://ws-feed-public.sandbox.exchange.coinbase.com'
          : 'wss://ws-feed.exchange.coinbase.com',
        wsUrl: coinbase.sandbox
          ? 'wss://ws-feed-public.sandbox.exchange.coinbase.com'
          : 'wss://ws-feed.exchange.coinbase.com',
        restUrl: coinbase.sandbox
          ? 'https://api-public.sandbox.exchange.coinbase.com'
          : 'https://api.exchange.coinbase.com',
        apiKey: coinbase.apiKey,
        apiSecret: coinbase.apiSecret,
        passphrase: coinbase.passphrase,
        symbols: coinbase.symbols
      });
      
      await this.coinbaseConnector.connect();
      this.logger.info('Coinbase connector initialized', {
        symbols: coinbase.symbols,
        sandbox: coinbase.sandbox
      });
    }
  }
  
  /**
   * Initialize execution optimizer with exchanges
   */
  private async initializeExecutionOptimizer(): Promise<void> {
    const exchanges: any[] = [];
    
    if (this.binanceConnector) {
      exchanges.push({
        id: 'binance',
        enabled: true,
        preferences: {
          priority: 1,
          maxOrderSize: 100000,
          minOrderSize: 10,
          allowedPairs: this.config.dataConnectors.binance?.symbols || [],
          feeOverride: {
            maker: 0.001,
            taker: 0.001,
            withdrawal: {},
            deposit: {}
          }
        },
        rateLimit: {
          requests: 1200,
          period: 60
        }
      });
    }
    
    if (this.coinbaseConnector) {
      exchanges.push({
        id: 'coinbase',
        enabled: true,
        preferences: {
          priority: 2,
          maxOrderSize: 50000,
          minOrderSize: 10,
          allowedPairs: this.config.dataConnectors.coinbase?.symbols || []
        },
        rateLimit: {
          requests: 10,
          period: 1
        }
      });
    }
    
    // Update config with exchanges
    await this.executionOptimizer.updateConfig({
      exchanges
    });
    
    // Start the service
    await this.executionOptimizer.start();
    
    this.logger.info('Execution optimizer initialized', {
      exchanges: exchanges.map(e => e.id)
    });
  }
  
  /**
   * Register trading strategies
   */
  private async registerStrategies(): Promise<void> {
    const { enabled, config } = this.config.strategies;
    
    // For local testing, register a simple test strategy
    if (enabled.includes('test-momentum')) {
      // Register with capital manager
      const wallet = await this.capitalManager.registerAgent(
        'test-momentum',
        'momentum-v1',
        10000 // $10k allocation
      );
      
      // Register with performance registry
      this.performanceRegistry.registerStrategy({
        strategyId: 'test-momentum',
        name: 'Test Momentum Strategy',
        version: '1.0.0',
        type: StrategyType.MOMENTUM,
        parameters: config['test-momentum'] || {},
        startedAt: Date.now(),
        status: StrategyStatus.ACTIVE,
        allocatedCapital: 10000,
        maxCapital: 20000,
        riskLimit: 15000,
        targetSharpe: 1.5,
        targetReturn: 0.20,
        description: 'Test momentum strategy for local development'
      });
      
      // Subscribe to alpha events
      this.alphaOrchestrator.subscribe({
        subscriberId: 'test-momentum-sub',
        strategyId: 'test-momentum',
        filters: {
          types: [SignalType.MOMENTUM_SURGE, SignalType.TREND_REVERSAL],
          minConfidence: 0.6
        },
        callback: (event) => {
          this.handleAlphaEvent('test-momentum', event);
        },
        priority: 5
      });
      
      this.logger.info('Test momentum strategy registered');
    }
  }
  
  /**
   * Set up system event listeners
   */
  private setupEventListeners(): void {
    // Safety events
    this.safetyController.on('emergency-stop', (event) => {
      this.logger.error('🚨 EMERGENCY STOP TRIGGERED', event);
      this.handleEmergencyStop(event);
    });
    
    this.safetyController.on('mode-changed', (event) => {
      this.logger.info('Trading mode changed', event);
    });
    
    // Performance alerts
    this.performanceRegistry.on('performance-alert', (alert) => {
      this.logger.warn('Performance alert', {
        strategy: alert.strategyId,
        type: alert.type,
        message: alert.message
      });
    });
    
    // Capital events
    this.capitalManager.on('agent-decommissioned', (result) => {
      this.logger.warn('Strategy decommissioned', {
        agentId: result.agentId,
        reason: result.errors?.[0] || 'Performance'
      });
    });
    
    // Market data events
    if (this.binanceConnector) {
      this.binanceConnector.on('market-data', (data) => {
        this.processMarketData('binance', data);
      });
    }
    
    if (this.coinbaseConnector) {
      this.coinbaseConnector.on('market-data', (data) => {
        this.processMarketData('coinbase', data);
      });
    }
  }
  
  /**
   * Start data feeds
   */
  private async startDataFeeds(): Promise<void> {
    // For local testing, generate some test signals
    if (this.config.mode === 'local') {
      this.startTestSignalGenerator();
    }
  }
  
  /**
   * Start mock market data generator for local testing
   */
  private startMockMarketData(): void {
    const symbols = this.config.dataConnectors.binance?.symbols || ['BTC-USDT', 'ETH-USDT'];
    
    // Generate mock price data
    const basePrices: Record<string, number> = {
      'BTC-USDT': 50000,
      'ETH-USDT': 3000,
      'BNB-USDT': 400
    };
    
    setInterval(() => {
      for (const symbol of symbols) {
        const basePrice = basePrices[symbol] || 1000;
        const variation = (Math.random() - 0.5) * 0.002; // 0.2% variation
        const price = basePrice * (1 + variation);
        
        // Emit mock market data
        this.emit('market-data', {
          exchange: 'mock',
          symbol,
          price,
          timestamp: Date.now(),
          bid: price * 0.9999,
          ask: price * 1.0001,
          volume: Math.random() * 1000000
        });
      }
    }, 1000); // Update every second
    
    this.logger.info('Mock market data generator started', { symbols });
  }
  
  /**
   * Generate test signals for local development
   */
  private startTestSignalGenerator(): void {
    setInterval(() => {
      if (!this.isRunning) return;
      
      // Generate random test signal
      const signals = [
        {
          type: SignalType.MOMENTUM_SURGE,
          direction: 'LONG' as const,
          strength: 70 + Math.random() * 30
        },
        {
          type: SignalType.TREND_REVERSAL,
          direction: 'SHORT' as const,
          strength: 60 + Math.random() * 40
        },
        {
          type: SignalType.VOLATILITY_SPIKE,
          direction: 'NEUTRAL' as const,
          strength: 50 + Math.random() * 50
        }
      ];
      
      const signal = signals[Math.floor(Math.random() * signals.length)];
      const symbols = this.config.dataConnectors.binance?.symbols || ['BTC-USD', 'ETH-USD'];
      const symbol = symbols[Math.floor(Math.random() * symbols.length)];
      
      this.alphaOrchestrator.submitSignal({
        id: `test_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        source: SignalSource.ALPHA_EXPLOITATION,
        type: signal.type,
        symbol,
        direction: signal.direction,
        strength: signal.strength,
        timeframe: 3600000, // 1 hour
        metadata: {
          generated: 'test',
          confidence: signal.strength / 100
        },
        timestamp: Date.now()
      });
      
    }, 5000); // Generate signal every 5 seconds
    
    this.logger.info('Test signal generator started');
  }
  
  /**
   * Process market data
   */
  private processMarketData(exchange: string, data: any): void {
    // Process market data and potentially generate signals
    this.emit('market-data', {
      exchange,
      symbol: data.symbol,
      price: data.price,
      timestamp: data.timestamp
    });
  }
  
  /**
   * Handle alpha events
   */
  private async handleAlphaEvent(strategyId: string, event: any): Promise<void> {
    this.logger.debug('Alpha event received', {
      strategy: strategyId,
      signal: event.signal,
      symbol: event.symbol,
      confidence: event.confidence
    });
    
    // In production, this would trigger actual trading
    // For local testing, just log and update performance
    if (event.confidence > 0.7 && event.direction !== 'NEUTRAL') {
      // Simulate a trade
      const tradeSize = 0.1; // Small test size
      const mockPrice = 50000 + Math.random() * 5000; // Mock BTC price
      
      this.performanceRegistry.recordTrade({
        id: `trade_${Date.now()}`,
        strategyId,
        symbol: event.symbol,
        side: event.direction === 'LONG' ? 'BUY' : 'SELL',
        quantity: tradeSize,
        price: mockPrice,
        fees: mockPrice * tradeSize * 0.001,
        slippage: 0.0005,
        pnl: (Math.random() - 0.5) * 100, // Random P&L for testing
        timestamp: Date.now()
      });
      
      this.logger.info('Test trade executed', {
        strategy: strategyId,
        symbol: event.symbol,
        side: event.direction
      });
    }
  }
  
  /**
   * Handle emergency stop
   */
  private async handleEmergencyStop(event: any): Promise<void> {
    this.logger.error('Executing emergency stop procedures...');
    
    // Stop all trading
    this.isRunning = false;
    
    // Stop execution service
    await this.executionOptimizer.stop();
    
    // Disconnect data feeds
    if (this.binanceConnector) {
      await this.binanceConnector.disconnect();
    }
    
    if (this.coinbaseConnector) {
      await this.coinbaseConnector.disconnect();
    }
    
    this.emit('system-stopped', {
      reason: event.reason,
      timestamp: Date.now()
    });
  }
  
  /**
   * Get system status
   */
  public getStatus(): any {
    const uptime = this.startTime ? Date.now() - this.startTime : 0;
    const capitalView = this.capitalManager.getCapitalAllocationView();
    const metrics = this.alphaOrchestrator.getMetrics();
    
    return {
      running: this.isRunning,
      uptime,
      mode: this.config.mode,
      tradingMode: this.safetyController.getTradingMode(),
      modules: {
        safety: 'active',
        alpha: {
          status: 'active',
          signalsProcessed: metrics.totalSignalsProcessed,
          alphaEvents: metrics.totalAlphaEvents
        },
        capital: {
          status: 'active',
          total: capitalView.totalCapital,
          allocated: capitalView.allocatedCapital,
          available: capitalView.reserveCapital
        },
        execution: 'active',
        performance: 'active'
      },
      dataFeeds: {
        binance: this.binanceConnector ? 'connected' : 'disabled',
        coinbase: this.coinbaseConnector ? 'connected' : 'disabled'
      }
    };
  }
  
  /**
   * Gracefully shutdown the system
   */
  public async shutdown(): Promise<void> {
    this.logger.info('Shutting down Noderr Protocol...');
    
    this.isRunning = false;
    
    // Stop execution service
    await this.executionOptimizer.stop();
    
    // Disconnect data feeds
    if (this.binanceConnector) {
      await this.binanceConnector.disconnect();
    }
    
    if (this.coinbaseConnector) {
      await this.coinbaseConnector.disconnect();
    }
    
    // Cleanup modules
    this.alphaOrchestrator.destroy();
    this.performanceRegistry.destroy();
    
    this.logger.info('✅ Shutdown complete');
    
    this.emit('system-shutdown', {
      timestamp: Date.now(),
      uptime: this.startTime ? Date.now() - this.startTime : 0
    });
  }
}

// Re-export TradingMode for convenience
export { TradingMode } from '../../safety-control/src/SafetyController'; 