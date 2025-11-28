/**
 * NumeraiIntegration - External ML Signal Integration
 * 
 * Integrates with Numerai.ai to leverage external machine learning
 * predictions and tournament signals for enhanced trading decisions
 */

import { EventEmitter } from 'events';
import { Logger } from 'winston';
import axios from 'axios';
import { createHash } from 'crypto';
import NodeCache from 'node-cache';
import { 
  ExternalSignal, 
  SignalProvider 
} from '@noderr/types';

interface NumeraiConfig {
  apiKey: string;
  apiSecret: string;
  modelId?: string;
  tournamentRound?: number;
  signalThreshold: number;
  cacheTimeout: number;
  maxRetries: number;
}

interface NumeraiPrediction {
  symbol: string;
  prediction: number;
  confidence: number;
  modelId: string;
  round: number;
  timestamp: number;
}

interface NumeraiSubmission {
  predictions: NumeraiPrediction[];
  modelId: string;
  round: number;
  submissionId?: string;
}

export class NumeraiIntegration extends EventEmitter implements SignalProvider {
  name = 'numerai';
  version = '1.0.0';
  
  private logger: Logger;
  private config: NumeraiConfig;
  private cache: NodeCache;
  private baseUrl = 'https://api.numer.ai';
  private isActive = false;
  private lastRound: number | null = null;
  
  constructor(logger: Logger, config: NumeraiConfig) {
    super();
    this.logger = logger;
    this.config = config;
    this.cache = new NodeCache({ 
      stdTTL: config.cacheTimeout,
      checkperiod: 120 
    });
  }
  
  async initialize(): Promise<void> {
    this.logger.info('Initializing Numerai integration', {
      modelId: this.config.modelId
    });
    
    try {
      // Verify credentials
      await this.verifyCredentials();
      
      // Get current tournament round
      this.lastRound = await this.getCurrentRound();
      
      this.isActive = true;
      this.logger.info('Numerai integration initialized', {
        round: this.lastRound
      });
      
    } catch (error) {
      this.logger.error('Failed to initialize Numerai integration', { error });
      throw error;
    }
  }
  
  /**
   * Get external signals from Numerai
   */
  async getSignals(symbols: string[]): Promise<ExternalSignal[]> {
    if (!this.isActive) {
      throw new Error('Numerai integration not active');
    }
    
    const signals: ExternalSignal[] = [];
    
    try {
      // Check cache first
      const cacheKey = `signals:${symbols.join(',')}`;
      const cached = this.cache.get<ExternalSignal[]>(cacheKey);
      if (cached) {
        return cached;
      }
      
      // Get predictions from Numerai
      const predictions = await this.fetchPredictions(symbols);
      
      // Convert to signals
      for (const pred of predictions) {
        if (Math.abs(pred.prediction) >= this.config.signalThreshold) {
          signals.push({
            provider: this.name,
            symbol: pred.symbol,
            signal: pred.prediction > 0 ? 'buy' : 'sell',
            strength: Math.abs(pred.prediction),
            confidence: pred.confidence,
            timestamp: pred.timestamp,
            metadata: {
              modelId: pred.modelId,
              round: pred.round,
              rawPrediction: pred.prediction
            }
          });
        }
      }
      
      // Cache results
      this.cache.set(cacheKey, signals);
      
      // Emit signals
      this.emit('signals:received', signals);
      
      return signals;
      
    } catch (error) {
      this.logger.error('Failed to get Numerai signals', { error });
      return [];
    }
  }
  
  /**
   * Submit predictions to Numerai tournament
   */
  async submitPredictions(predictions: NumeraiPrediction[]): Promise<NumeraiSubmission> {
    if (!this.isActive) {
      throw new Error('Numerai integration not active');
    }
    
    try {
      const round = await this.getCurrentRound();
      
      // Format submission
      const submission: NumeraiSubmission = {
        predictions,
        modelId: this.config.modelId || 'default',
        round
      };
      
      // Sign request
      const signature = this.signRequest(submission);
      
      // Submit to Numerai
      const response = await this.makeRequest('/submissions', 'POST', {
        ...submission,
        signature
      });
      
      submission.submissionId = response.submissionId;
      
      this.logger.info('Submitted predictions to Numerai', {
        submissionId: submission.submissionId,
        predictionCount: predictions.length,
        round
      });
      
      return submission;
      
    } catch (error) {
      this.logger.error('Failed to submit predictions', { error });
      throw error;
    }
  }
  
  /**
   * Fetch predictions from Numerai
   */
  private async fetchPredictions(symbols: string[]): Promise<NumeraiPrediction[]> {
    const predictions: NumeraiPrediction[] = [];
    
    try {
      // Get latest tournament data
      const tournamentData = await this.getTournamentData();
      
      // Map symbols to Numerai universe
      const mappedSymbols = this.mapSymbolsToNumerai(symbols);
      
      // Get predictions for each symbol
      for (const symbol of mappedSymbols) {
        const pred = tournamentData.predictions?.[symbol];
        if (pred) {
          predictions.push({
            symbol: this.mapNumeraiToSymbol(symbol),
            prediction: pred.value,
            confidence: pred.confidence || 0.5,
            modelId: this.config.modelId || 'default',
            round: tournamentData.round,
            timestamp: Date.now()
          });
        }
      }
      
      return predictions;
      
    } catch (error) {
      this.logger.error('Failed to fetch predictions', { error });
      return [];
    }
  }
  
  /**
   * Get tournament data from Numerai
   */
  private async getTournamentData(): Promise<any> {
    const cacheKey = 'tournament:data';
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;
    
    const data = await this.makeRequest('/tournament/data', 'GET');
    this.cache.set(cacheKey, data, 3600); // Cache for 1 hour
    
    return data;
  }
  
  /**
   * Get current tournament round
   */
  private async getCurrentRound(): Promise<number> {
    const data = await this.makeRequest('/tournament/current', 'GET');
    return data.round;
  }
  
  /**
   * Verify API credentials
   */
  private async verifyCredentials(): Promise<void> {
    try {
      await this.makeRequest('/account', 'GET');
    } catch (error) {
      throw new Error('Invalid Numerai credentials');
    }
  }
  
  /**
   * Make authenticated request to Numerai API
   */
  private async makeRequest(
    endpoint: string, 
    method: string, 
    data?: any
  ): Promise<any> {
    const url = `${this.baseUrl}${endpoint}`;
    const headers = {
      'x-api-key': this.config.apiKey,
      'Content-Type': 'application/json'
    };
    
    let retries = 0;
    while (retries < this.config.maxRetries) {
      try {
        const response = await axios({
          method,
          url,
          headers,
          data,
          timeout: 30000
        });
        
        return response.data;
        
      } catch (error: any) {
        retries++;
        
        if (error.response?.status === 429) {
          // Rate limited - wait and retry
          const delay = Math.pow(2, retries) * 1000;
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        
        if (retries >= this.config.maxRetries) {
          throw error;
        }
      }
    }
  }
  
  /**
   * Sign request for authentication
   */
  private signRequest(data: any): string {
    const payload = JSON.stringify(data);
    return createHash('sha256')
      .update(payload + this.config.apiSecret)
      .digest('hex');
  }
  
  /**
   * Map trading symbols to Numerai universe
   */
  private mapSymbolsToNumerai(symbols: string[]): string[] {
    // Simplified mapping - would have full mapping table in production
    const mapping: Record<string, string> = {
      'BTC-USD': 'BITCOIN',
      'ETH-USD': 'ETHEREUM',
      'BNB-USD': 'BINANCE',
      'SOL-USD': 'SOLANA',
      'ADA-USD': 'CARDANO'
    };
    
    return symbols
      .map(s => mapping[s])
      .filter(s => s !== undefined) as string[];
  }
  
  /**
   * Map Numerai symbols back to trading symbols
   */
  private mapNumeraiToSymbol(numeraiSymbol: string): string {
    // Reverse mapping
    const mapping: Record<string, string> = {
      'BITCOIN': 'BTC-USD',
      'ETHEREUM': 'ETH-USD',
      'BINANCE': 'BNB-USD',
      'SOLANA': 'SOL-USD',
      'CARDANO': 'ADA-USD'
    };
    
    return mapping[numeraiSymbol] || numeraiSymbol;
  }
  
  /**
   * Get historical performance from Numerai
   */
  async getPerformance(modelId?: string): Promise<any> {
    const id = modelId || this.config.modelId;
    const cacheKey = `performance:${id}`;
    
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;
    
    const performance = await this.makeRequest(`/models/${id}/performance`, 'GET');
    this.cache.set(cacheKey, performance, 3600);
    
    return performance;
  }
  
  /**
   * Get leaderboard position
   */
  async getLeaderboardPosition(): Promise<number> {
    const leaderboard = await this.makeRequest('/tournament/leaderboard', 'GET');
    const modelId = this.config.modelId || 'default';
    
    const position = leaderboard.findIndex((m: any) => m.modelId === modelId);
    return position >= 0 ? position + 1 : -1;
  }
  
  /**
   * Monitor tournament updates
   */
  async startMonitoring(interval: number = 3600000): Promise<void> {
    const monitor = async () => {
      try {
        const currentRound = await this.getCurrentRound();
        
        if (currentRound !== this.lastRound) {
          this.lastRound = currentRound;
          this.emit('tournament:new_round', currentRound);
          
          // Clear cache for new round
          this.cache.flushAll();
        }
        
        // Check performance
        const performance = await this.getPerformance();
        this.emit('performance:update', performance);
        
      } catch (error) {
        this.logger.error('Monitoring error', { error });
      }
    };
    
    // Initial check
    await monitor();
    
    // Set up interval
    setInterval(monitor, interval);
  }
  
  /**
   * Get signal statistics
   */
  getStats() {
    return {
      provider: this.name,
      active: this.isActive,
      currentRound: this.lastRound,
      cacheSize: this.cache.keys().length,
      signalThreshold: this.config.signalThreshold
    };
  }
  
  /**
   * Stop integration
   */
  async stop(): Promise<void> {
    this.logger.info('Stopping Numerai integration');
    this.isActive = false;
    this.cache.flushAll();
  }
} 