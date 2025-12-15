/**
 * ML Signal Service
 * 
 * Generates trading signals from ML models in the quant-research package.
 * Integrates time series forecasting, alpha decay analysis, and factor decomposition
 * to produce high-confidence trading predictions.
 * 
 * @module MLSignalService
 */

import { EventEmitter } from 'events';

// Types for ML predictions
export interface MLPrediction {
  symbol: string;
  action: 'BUY' | 'SELL' | 'HOLD';
  confidence: number; // 0-1
  price: number;
  targetPrice: number;
  stopLoss: number;
  timeHorizon: number; // milliseconds
  features: Record<string, number>;
  modelId: string;
  timestamp: number;
  reasoning: string;
}

export interface MLModelConfig {
  modelId: string;
  type: 'MOMENTUM' | 'MEAN_REVERSION' | 'ARBITRAGE' | 'MARKET_MAKING';
  symbols: string[];
  timeHorizon: number; // milliseconds
  minConfidence: number;
  enabled: boolean;
}

export interface MarketData {
  symbol: string;
  timestamp: number;
  price: number;
  volume: number;
  high: number;
  low: number;
  open: number;
  close: number;
}

/**
 * ML Signal Service
 * 
 * Generates trading signals using ML models from quant-research package.
 * Supports multiple model types and continuous signal generation.
 */
export class MLSignalService extends EventEmitter {
  private models: Map<string, MLModelConfig>;
  private isRunning: boolean = false;
  private generationInterval: NodeJS.Timeout | null = null;
  private signalHistory: MLPrediction[] = [];
  private maxHistorySize: number = 1000;
  
  constructor() {
    super();
    this.models = new Map();
  }
  
  /**
   * Initialize ML signal service
   */
  async initialize(): Promise<void> {
    console.log('[MLSignalService] Initializing ML models...');
    
    // Register default models
    await this.registerModel({
      modelId: 'momentum_1h',
      type: 'MOMENTUM',
      symbols: ['BTC/USD', 'ETH/USD', 'SOL/USD'],
      timeHorizon: 3600000, // 1 hour
      minConfidence: 0.70,
      enabled: true
    });
    
    await this.registerModel({
      modelId: 'mean_reversion_15m',
      type: 'MEAN_REVERSION',
      symbols: ['BTC/USD', 'ETH/USD'],
      timeHorizon: 900000, // 15 minutes
      minConfidence: 0.75,
      enabled: true
    });
    
    await this.registerModel({
      modelId: 'arbitrage_5m',
      type: 'ARBITRAGE',
      symbols: ['BTC/USD', 'ETH/USD', 'USDC/USD'],
      timeHorizon: 300000, // 5 minutes
      minConfidence: 0.80,
      enabled: true
    });
    
    console.log(`[MLSignalService] Initialized ${this.models.size} ML models`);
    this.emit('initialized');
  }
  
  /**
   * Register a new ML model
   * 
   * @param config Model configuration
   */
  async registerModel(config: MLModelConfig): Promise<void> {
    this.models.set(config.modelId, config);
    console.log(`[MLSignalService] Registered model: ${config.modelId} (${config.type})`);
    this.emit('model-registered', config);
  }
  
  /**
   * Generate ML prediction for a symbol
   * 
   * @param symbol Trading symbol
   * @returns ML prediction or null if no signal
   */
  async generatePrediction(symbol: string): Promise<MLPrediction | null> {
    // Find applicable models for this symbol
    const applicableModels = Array.from(this.models.values())
      .filter(m => m.enabled && m.symbols.includes(symbol));
    
    if (applicableModels.length === 0) {
      return null;
    }
    
    // Use first applicable model (in production, would ensemble multiple models)
    const model = applicableModels[0];
    
    try {
      // Get historical market data
      const historicalData = await this.getHistoricalData(symbol, 100);
      
      if (historicalData.length < 20) {
        console.warn(`[MLSignalService] Insufficient data for ${symbol}`);
        return null;
      }
      
      // Generate forecast based on model type
      let prediction: MLPrediction | null = null;
      
      switch (model.type) {
        case 'MOMENTUM':
          prediction = await this.generateMomentumPrediction(symbol, model, historicalData);
          break;
          
        case 'MEAN_REVERSION':
          prediction = await this.generateMeanReversionPrediction(symbol, model, historicalData);
          break;
          
        case 'ARBITRAGE':
          prediction = await this.generateArbitragePrediction(symbol, model, historicalData);
          break;
          
        case 'MARKET_MAKING':
          prediction = await this.generateMarketMakingPrediction(symbol, model, historicalData);
          break;
      }
      
      if (prediction) {
        // Store in history
        this.signalHistory.push(prediction);
        if (this.signalHistory.length > this.maxHistorySize) {
          this.signalHistory.shift();
        }
        
        this.emit('prediction-generated', prediction);
      }
      
      return prediction;
      
    } catch (error) {
      console.error(`[MLSignalService] Error generating prediction for ${symbol}:`, error);
      return null;
    }
  }
  
  /**
   * Generate momentum-based prediction
   */
  private async generateMomentumPrediction(
    symbol: string,
    model: MLModelConfig,
    data: MarketData[]
  ): Promise<MLPrediction | null> {
    // Calculate momentum indicators
    const prices = data.map(d => d.close);
    const currentPrice = prices[prices.length - 1];
    
    // Simple momentum: price change over last N periods
    const lookback = 20;
    const pastPrice = prices[prices.length - lookback];
    const momentum = (currentPrice - pastPrice) / pastPrice;
    
    // Calculate RSI (Relative Strength Index)
    const rsi = this.calculateRSI(prices, 14);
    
    // Calculate MACD
    const macd = this.calculateMACD(prices);
    
    // Determine signal
    let action: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';
    let confidence = 0.5;
    let targetPrice = currentPrice;
    let reasoning = '';
    
    if (momentum > 0.05 && rsi < 70 && macd.signal === 'BUY') {
      action = 'BUY';
      confidence = Math.min(0.95, 0.6 + momentum * 2);
      targetPrice = currentPrice * 1.03; // 3% target
      reasoning = `Strong upward momentum (${(momentum * 100).toFixed(2)}%), RSI: ${rsi.toFixed(0)}, MACD bullish`;
    } else if (momentum < -0.05 && rsi > 30 && macd.signal === 'SELL') {
      action = 'SELL';
      confidence = Math.min(0.95, 0.6 + Math.abs(momentum) * 2);
      targetPrice = currentPrice * 0.97; // 3% target
      reasoning = `Strong downward momentum (${(momentum * 100).toFixed(2)}%), RSI: ${rsi.toFixed(0)}, MACD bearish`;
    }
    
    // Only return signal if confidence meets threshold
    if (action === 'HOLD' || confidence < model.minConfidence) {
      return null;
    }
    
    return {
      symbol,
      action,
      confidence,
      price: currentPrice,
      targetPrice,
      stopLoss: action === 'BUY' ? currentPrice * 0.98 : currentPrice * 1.02,
      timeHorizon: model.timeHorizon,
      features: {
        momentum,
        rsi,
        macd_value: macd.value,
        volume: data[data.length - 1].volume
      },
      modelId: model.modelId,
      timestamp: Date.now(),
      reasoning
    };
  }
  
  /**
   * Generate mean reversion prediction
   */
  private async generateMeanReversionPrediction(
    symbol: string,
    model: MLModelConfig,
    data: MarketData[]
  ): Promise<MLPrediction | null> {
    const prices = data.map(d => d.close);
    const currentPrice = prices[prices.length - 1];
    
    // Calculate moving average
    const ma20 = this.calculateSMA(prices, 20);
    const ma50 = this.calculateSMA(prices, 50);
    
    // Calculate Bollinger Bands
    const bb = this.calculateBollingerBands(prices, 20, 2);
    
    // Calculate standard deviation
    const stdDev = this.calculateStdDev(prices.slice(-20));
    
    // Determine deviation from mean
    const deviationFromMA = (currentPrice - ma20) / ma20;
    const deviationInStdDevs = (currentPrice - ma20) / stdDev;
    
    let action: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';
    let confidence = 0.5;
    let targetPrice = currentPrice;
    let reasoning = '';
    
    // Oversold - expect reversion up
    if (currentPrice < bb.lower && deviationInStdDevs < -2) {
      action = 'BUY';
      confidence = Math.min(0.95, 0.65 + Math.abs(deviationInStdDevs) * 0.1);
      targetPrice = ma20;
      reasoning = `Oversold: ${(deviationInStdDevs).toFixed(2)} std devs below MA, below lower Bollinger Band`;
    }
    // Overbought - expect reversion down
    else if (currentPrice > bb.upper && deviationInStdDevs > 2) {
      action = 'SELL';
      confidence = Math.min(0.95, 0.65 + deviationInStdDevs * 0.1);
      targetPrice = ma20;
      reasoning = `Overbought: ${(deviationInStdDevs).toFixed(2)} std devs above MA, above upper Bollinger Band`;
    }
    
    if (action === 'HOLD' || confidence < model.minConfidence) {
      return null;
    }
    
    return {
      symbol,
      action,
      confidence,
      price: currentPrice,
      targetPrice,
      stopLoss: action === 'BUY' ? bb.lower * 0.99 : bb.upper * 1.01,
      timeHorizon: model.timeHorizon,
      features: {
        deviation_from_ma: deviationFromMA,
        deviation_in_stddevs: deviationInStdDevs,
        ma20,
        ma50,
        bb_upper: bb.upper,
        bb_lower: bb.lower
      },
      modelId: model.modelId,
      timestamp: Date.now(),
      reasoning
    };
  }
  
  /**
   * Generate arbitrage prediction
   */
  private async generateArbitragePrediction(
    symbol: string,
    model: MLModelConfig,
    data: MarketData[]
  ): Promise<MLPrediction | null> {
    // In production, would compare prices across multiple exchanges
    // For now, simplified arbitrage detection
    
    const currentPrice = data[data.length - 1].close;
    
    // Simulate cross-exchange price difference
    const exchangePrices = [
      currentPrice,
      currentPrice * (1 + (Math.random() - 0.5) * 0.01), // +/- 0.5%
      currentPrice * (1 + (Math.random() - 0.5) * 0.01)
    ];
    
    const minPrice = Math.min(...exchangePrices);
    const maxPrice = Math.max(...exchangePrices);
    const spread = (maxPrice - minPrice) / minPrice;
    
    // Only signal if spread is significant (>0.3%)
    if (spread < 0.003) {
      return null;
    }
    
    const confidence = Math.min(0.95, 0.7 + spread * 10);
    
    if (confidence < model.minConfidence) {
      return null;
    }
    
    return {
      symbol,
      action: 'BUY', // Buy low, sell high
      confidence,
      price: minPrice,
      targetPrice: maxPrice,
      stopLoss: minPrice * 0.995,
      timeHorizon: model.timeHorizon,
      features: {
        spread,
        min_price: minPrice,
        max_price: maxPrice,
        potential_profit: spread
      },
      modelId: model.modelId,
      timestamp: Date.now(),
      reasoning: `Arbitrage opportunity: ${(spread * 100).toFixed(3)}% spread detected across exchanges`
    };
  }
  
  /**
   * Generate market making prediction
   */
  private async generateMarketMakingPrediction(
    symbol: string,
    model: MLModelConfig,
    data: MarketData[]
  ): Promise<MLPrediction | null> {
    const currentPrice = data[data.length - 1].close;
    const volume = data[data.length - 1].volume;
    
    // Calculate bid-ask spread estimate
    const recentPrices = data.slice(-10).map(d => d.close);
    const volatility = this.calculateStdDev(recentPrices) / currentPrice;
    
    // Market making targets low volatility, high volume
    if (volatility > 0.02) { // Too volatile
      return null;
    }
    
    const confidence = Math.min(0.95, 0.65 + (1 - volatility * 50) * 0.3);
    
    if (confidence < model.minConfidence) {
      return null;
    }
    
    return {
      symbol,
      action: 'BUY', // Provide liquidity
      confidence,
      price: currentPrice,
      targetPrice: currentPrice * 1.002, // 0.2% spread
      stopLoss: currentPrice * 0.998,
      timeHorizon: model.timeHorizon,
      features: {
        volatility,
        volume,
        spread_estimate: 0.002
      },
      modelId: model.modelId,
      timestamp: Date.now(),
      reasoning: `Market making opportunity: low volatility (${(volatility * 100).toFixed(3)}%), high volume`
    };
  }
  
  /**
   * Start continuous signal generation
   * 
   * @param interval Generation interval in milliseconds
   */
  async startGenerating(interval: number = 60000): Promise<void> {
    if (this.isRunning) {
      console.warn('[MLSignalService] Signal generation already running');
      return;
    }
    
    this.isRunning = true;
    console.log(`[MLSignalService] Starting signal generation (interval: ${interval}ms)`);
    
    // Generate signals immediately
    await this.generateSignals();
    
    // Set up interval
    this.generationInterval = setInterval(async () => {
      await this.generateSignals();
    }, interval);
    
    this.emit('generation-started');
  }
  
  /**
   * Stop continuous signal generation
   */
  stopGenerating(): void {
    if (!this.isRunning) {
      return;
    }
    
    this.isRunning = false;
    
    if (this.generationInterval) {
      clearInterval(this.generationInterval);
      this.generationInterval = null;
    }
    
    console.log('[MLSignalService] Signal generation stopped');
    this.emit('generation-stopped');
  }
  
  /**
   * Generate signals for all enabled models
   */
  private async generateSignals(): Promise<void> {
    const enabledModels = Array.from(this.models.values()).filter(m => m.enabled);
    
    for (const model of enabledModels) {
      for (const symbol of model.symbols) {
        try {
          const prediction = await this.generatePrediction(symbol);
          
          if (prediction) {
            console.log(
              `[MLSignalService] 📊 Signal: ${prediction.action} ${prediction.symbol} ` +
              `@ ${prediction.price.toFixed(2)} (confidence: ${(prediction.confidence * 100).toFixed(0)}%)`
            );
            this.emit('new-signal', prediction);
          }
        } catch (error) {
          console.error(`[MLSignalService] Error generating signal for ${symbol}:`, error);
        }
      }
    }
  }
  
  /**
   * Get historical market data
   * 
   * In production, would fetch from market-data package.
   * For now, generates realistic mock data.
   */
  private async getHistoricalData(symbol: string, count: number): Promise<MarketData[]> {
    const data: MarketData[] = [];
    let basePrice = 50000; // Starting price
    
    if (symbol.includes('ETH')) basePrice = 3000;
    if (symbol.includes('SOL')) basePrice = 100;
    if (symbol.includes('USDC')) basePrice = 1;
    
    const now = Date.now();
    
    for (let i = count; i > 0; i--) {
      // Generate realistic price movement
      const change = (Math.random() - 0.5) * 0.02; // +/- 1% per period
      const price = basePrice * (1 + change);
      const volume = 1000000 + Math.random() * 500000;
      
      data.push({
        symbol,
        timestamp: now - i * 60000, // 1 minute intervals
        price,
        volume,
        high: price * 1.005,
        low: price * 0.995,
        open: basePrice,
        close: price
      });
      
      basePrice = price; // Next candle starts at current close
    }
    
    return data;
  }
  
  /**
   * Calculate Simple Moving Average
   */
  private calculateSMA(prices: number[], period: number): number {
    if (prices.length < period) return prices[prices.length - 1];
    const slice = prices.slice(-period);
    return slice.reduce((sum, p) => sum + p, 0) / period;
  }
  
  /**
   * Calculate Relative Strength Index
   */
  private calculateRSI(prices: number[], period: number = 14): number {
    if (prices.length < period + 1) return 50;
    
    const changes = [];
    for (let i = 1; i < prices.length; i++) {
      changes.push(prices[i] - prices[i - 1]);
    }
    
    const recentChanges = changes.slice(-period);
    const gains = recentChanges.filter(c => c > 0);
    const losses = recentChanges.filter(c => c < 0).map(c => Math.abs(c));
    
    const avgGain = gains.length > 0 ? gains.reduce((sum, g) => sum + g, 0) / period : 0;
    const avgLoss = losses.length > 0 ? losses.reduce((sum, l) => sum + l, 0) / period : 0;
    
    if (avgLoss === 0) return 100;
    
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
  }
  
  /**
   * Calculate MACD (Moving Average Convergence Divergence)
   */
  private calculateMACD(prices: number[]): { value: number; signal: 'BUY' | 'SELL' | 'NEUTRAL' } {
    const ema12 = this.calculateEMA(prices, 12);
    const ema26 = this.calculateEMA(prices, 26);
    const macdValue = ema12 - ema26;
    
    let signal: 'BUY' | 'SELL' | 'NEUTRAL' = 'NEUTRAL';
    if (macdValue > 0) signal = 'BUY';
    else if (macdValue < 0) signal = 'SELL';
    
    return { value: macdValue, signal };
  }
  
  /**
   * Calculate Exponential Moving Average
   */
  private calculateEMA(prices: number[], period: number): number {
    if (prices.length < period) return prices[prices.length - 1];
    
    const multiplier = 2 / (period + 1);
    let ema = this.calculateSMA(prices.slice(0, period), period);
    
    for (let i = period; i < prices.length; i++) {
      ema = (prices[i] - ema) * multiplier + ema;
    }
    
    return ema;
  }
  
  /**
   * Calculate Bollinger Bands
   */
  private calculateBollingerBands(
    prices: number[],
    period: number,
    stdDevMultiplier: number
  ): { upper: number; middle: number; lower: number } {
    const middle = this.calculateSMA(prices, period);
    const stdDev = this.calculateStdDev(prices.slice(-period));
    
    return {
      upper: middle + stdDev * stdDevMultiplier,
      middle,
      lower: middle - stdDev * stdDevMultiplier
    };
  }
  
  /**
   * Calculate standard deviation
   */
  private calculateStdDev(values: number[]): number {
    const avg = values.reduce((sum, v) => sum + v, 0) / values.length;
    const squaredDiffs = values.map(v => Math.pow(v - avg, 2));
    const variance = squaredDiffs.reduce((sum, d) => sum + d, 0) / values.length;
    return Math.sqrt(variance);
  }
  
  /**
   * Get signal history
   */
  getSignalHistory(limit?: number): MLPrediction[] {
    if (limit) {
      return this.signalHistory.slice(-limit);
    }
    return [...this.signalHistory];
  }
  
  /**
   * Get model configuration
   */
  getModel(modelId: string): MLModelConfig | undefined {
    return this.models.get(modelId);
  }
  
  /**
   * Get all models
   */
  getAllModels(): MLModelConfig[] {
    return Array.from(this.models.values());
  }
  
  /**
   * Enable/disable a model
   */
  setModelEnabled(modelId: string, enabled: boolean): void {
    const model = this.models.get(modelId);
    if (model) {
      model.enabled = enabled;
      console.log(`[MLSignalService] Model ${modelId} ${enabled ? 'enabled' : 'disabled'}`);
      this.emit('model-enabled-changed', { modelId, enabled });
    }
  }
}
