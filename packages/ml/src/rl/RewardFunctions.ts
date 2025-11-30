/**
 * RewardFunctions - Reward calculation strategies for RL agents
 * 
 * Implements various reward functions optimized for trading performance
 * including Sharpe ratio, risk-adjusted returns, and custom objectives
 */

import { MarketState, RLAction, RewardFunction } from '@noderr/types';

/**
 * Base reward function implementation
 */
abstract class BaseRewardFunction implements RewardFunction {
  abstract name: string;
  
  abstract calculate(
    state: MarketState, 
    action: RLAction, 
    nextState: MarketState
  ): number;
  
  /**
   * Calculate price return between states
   */
  protected calculateReturn(
    state: MarketState, 
    nextState: MarketState, 
    symbol: string
  ): number {
    const currentPrice = state.prices[symbol] || 0;
    const nextPrice = nextState.prices[symbol] || 0;
    
    if (currentPrice === 0) return 0;
    
    return (nextPrice - currentPrice) / currentPrice;
  }
  
  /**
   * Calculate portfolio value
   */
  protected calculatePortfolioValue(state: MarketState): number {
    let value = state.accountBalance;
    
    for (const position of state.positions) {
      const currentPrice = state.prices[position.symbol] || position.currentPrice;
      value += position.quantity * currentPrice;
    }
    
    return value;
  }
}

/**
 * Sharpe ratio based reward function
 */
export class SharpeRewardFunction extends BaseRewardFunction {
  name = 'sharpe';
  private returns: number[] = [];
  private lookback = 100;
  
  calculate(
    state: MarketState, 
    action: RLAction, 
    nextState: MarketState
  ): number {
    // Calculate portfolio return
    const currentValue = this.calculatePortfolioValue(state);
    const nextValue = this.calculatePortfolioValue(nextState);
    
    if (currentValue === 0) return 0;
    
    const portfolioReturn = (nextValue - currentValue) / currentValue;
    
    // Update returns history
    this.returns.push(portfolioReturn);
    if (this.returns.length > this.lookback) {
      this.returns.shift();
    }
    
    // Calculate Sharpe ratio
    if (this.returns.length < 2) {
      return portfolioReturn; // Not enough data for Sharpe
    }
    
    const mean = this.returns.reduce((a, b) => a + b, 0) / this.returns.length;
    const variance = this.returns.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / this.returns.length;
    const std = Math.sqrt(variance);
    
    // Annualized Sharpe ratio as reward
    const sharpe = std > 0 ? (mean / std) * Math.sqrt(252) : 0;
    
    // Scale and add immediate return bonus
    return 0.1 * sharpe + portfolioReturn;
  }
}

/**
 * Risk-adjusted reward function
 */
export class RiskAdjustedRewardFunction extends BaseRewardFunction {
  name = 'risk_adjusted';
  
  constructor(
    private config: {
      maxDrawdown: number;
      volatilityPenalty: number;
      positionLimitPenalty: number;
    }
  ) {
    super();
  }
  
  calculate(
    state: MarketState, 
    action: RLAction, 
    nextState: MarketState
  ): number {
    // Base return reward
    const portfolioReturn = this.calculatePortfolioReturn(state, nextState);
    
    // Risk penalties
    const drawdownPenalty = this.calculateDrawdownPenalty(state, nextState);
    const volatilityPenalty = this.calculateVolatilityPenalty(action);
    const positionPenalty = this.calculatePositionPenalty(state, action);
    
    // Transaction cost penalty
    const transactionCost = this.calculateTransactionCost(action);
    
    // Combined reward
    let reward = portfolioReturn;
    reward -= drawdownPenalty;
    reward -= volatilityPenalty;
    reward -= positionPenalty;
    reward -= transactionCost;
    
    // Bonus for profitable trades
    if (portfolioReturn > 0 && action.type === 'sell') {
      reward += 0.01; // Profit-taking bonus
    }
    
    return reward;
  }
  
  private calculatePortfolioReturn(state: MarketState, nextState: MarketState): number {
    const currentValue = this.calculatePortfolioValue(state);
    const nextValue = this.calculatePortfolioValue(nextState);
    
    return currentValue > 0 ? (nextValue - currentValue) / currentValue : 0;
  }
  
  private calculateDrawdownPenalty(state: MarketState, nextState: MarketState): number {
    const currentValue = this.calculatePortfolioValue(state);
    const nextValue = this.calculatePortfolioValue(nextState);
    
    // Track peak value (would be maintained in real implementation)
    const peakValue = Math.max(currentValue, nextValue);
    const drawdown = peakValue > 0 ? (peakValue - nextValue) / peakValue : 0;
    
    // Exponential penalty for approaching max drawdown
    if (drawdown > this.config.maxDrawdown * 0.8) {
      return 0.1 * Math.exp(drawdown / this.config.maxDrawdown);
    }
    
    return 0;
  }
  
  private calculateVolatilityPenalty(action: RLAction): number {
    // Penalize large positions in volatile markets
    return action.quantity * this.config.volatilityPenalty;
  }
  
  private calculatePositionPenalty(state: MarketState, action: RLAction): number {
    // Penalize if too many positions
    const numPositions = state.positions.length;
    const maxPositions = 10;
    
    if (numPositions > maxPositions && action.type === 'buy') {
      return this.config.positionLimitPenalty;
    }
    
    return 0;
  }
  
  private calculateTransactionCost(action: RLAction): number {
    // Simplified transaction cost model
    const baseCost = 0.001; // 10 bps
    const slippageMultiplier = action.orderType === 'market' ? 1.5 : 1.0;
    
    return action.quantity * baseCost * slippageMultiplier;
  }
}

/**
 * Profit factor reward function
 */
export class ProfitFactorRewardFunction extends BaseRewardFunction {
  name = 'profit_factor';
  private profits: number[] = [];
  private losses: number[] = [];
  
  calculate(
    state: MarketState, 
    action: RLAction, 
    nextState: MarketState
  ): number {
    const portfolioReturn = this.calculatePortfolioReturn(state, nextState);
    
    // Track profits and losses
    if (portfolioReturn > 0) {
      this.profits.push(portfolioReturn);
    } else if (portfolioReturn < 0) {
      this.losses.push(Math.abs(portfolioReturn));
    }
    
    // Maintain window
    if (this.profits.length > 100) this.profits.shift();
    if (this.losses.length > 100) this.losses.shift();
    
    // Calculate profit factor
    const totalProfits = this.profits.reduce((a, b) => a + b, 0);
    const totalLosses = this.losses.reduce((a, b) => a + b, 0);
    
    const profitFactor = totalLosses > 0 ? totalProfits / totalLosses : 1;
    
    // Reward based on profit factor and immediate return
    return portfolioReturn * Math.log(1 + profitFactor);
  }
  
  private calculatePortfolioReturn(state: MarketState, nextState: MarketState): number {
    const currentValue = this.calculatePortfolioValue(state);
    const nextValue = this.calculatePortfolioValue(nextState);
    
    return currentValue > 0 ? (nextValue - currentValue) / currentValue : 0;
  }
}

/**
 * Information ratio reward function
 */
export class InformationRatioRewardFunction extends BaseRewardFunction {
  name = 'information_ratio';
  private returns: number[] = [];
  private benchmarkReturns: number[] = [];
  
  calculate(
    state: MarketState, 
    action: RLAction, 
    nextState: MarketState
  ): number {
    // Portfolio return
    const portfolioReturn = this.calculatePortfolioReturn(state, nextState);
    
    // Benchmark return (could be market index)
    const benchmarkReturn = this.calculateBenchmarkReturn(state, nextState);
    
    // Active return
    const activeReturn = portfolioReturn - benchmarkReturn;
    
    // Update history
    this.returns.push(activeReturn);
    if (this.returns.length > 100) this.returns.shift();
    
    // Calculate information ratio
    if (this.returns.length < 2) return activeReturn;
    
    const mean = this.returns.reduce((a, b) => a + b, 0) / this.returns.length;
    const variance = this.returns.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / this.returns.length;
    const trackingError = Math.sqrt(variance);
    
    const informationRatio = trackingError > 0 ? mean / trackingError : 0;
    
    // Reward based on IR and immediate active return
    return 0.1 * informationRatio + activeReturn;
  }
  
  private calculatePortfolioReturn(state: MarketState, nextState: MarketState): number {
    const currentValue = this.calculatePortfolioValue(state);
    const nextValue = this.calculatePortfolioValue(nextState);
    
    return currentValue > 0 ? (nextValue - currentValue) / currentValue : 0;
  }
  
  private calculateBenchmarkReturn(state: MarketState, nextState: MarketState): number {
    // Simple equal-weight benchmark
    const symbols = Object.keys(state.prices);
    let totalReturn = 0;
    
    for (const symbol of symbols.slice(0, 5)) { // Top 5 assets
      totalReturn += this.calculateReturn(state, nextState, symbol);
    }
    
    return symbols.length > 0 ? totalReturn / Math.min(symbols.length, 5) : 0;
  }
}

/**
 * Sortino ratio reward function (downside risk focus)
 */
export class SortinoRewardFunction extends BaseRewardFunction {
  name = 'sortino';
  private returns: number[] = [];
  private targetReturn = 0; // Minimum acceptable return
  
  calculate(
    state: MarketState, 
    action: RLAction, 
    nextState: MarketState
  ): number {
    const portfolioReturn = this.calculatePortfolioReturn(state, nextState);
    
    // Update returns
    this.returns.push(portfolioReturn);
    if (this.returns.length > 100) this.returns.shift();
    
    if (this.returns.length < 2) return portfolioReturn;
    
    // Calculate downside deviation
    const downsideReturns = this.returns
      .filter(r => r < this.targetReturn)
      .map(r => Math.pow(r - this.targetReturn, 2));
    
    const downsideVariance = downsideReturns.length > 0
      ? downsideReturns.reduce((a, b) => a + b, 0) / downsideReturns.length
      : 0;
    
    const downsideDeviation = Math.sqrt(downsideVariance);
    
    // Calculate Sortino ratio
    const meanReturn = this.returns.reduce((a, b) => a + b, 0) / this.returns.length;
    const excessReturn = meanReturn - this.targetReturn;
    
    const sortino = downsideDeviation > 0 ? excessReturn / downsideDeviation : excessReturn;
    
    // Reward combines Sortino and immediate return
    return 0.1 * sortino + portfolioReturn;
  }
  
  private calculatePortfolioReturn(state: MarketState, nextState: MarketState): number {
    const currentValue = this.calculatePortfolioValue(state);
    const nextValue = this.calculatePortfolioValue(nextState);
    
    return currentValue > 0 ? (nextValue - currentValue) / currentValue : 0;
  }
}

/**
 * Factory function to create reward functions
 */
export function createRewardFunction(
  type: string, 
  config?: any
): RewardFunction {
  switch (type) {
    case 'sharpe':
      return new SharpeRewardFunction();
    
    case 'risk_adjusted':
      return new RiskAdjustedRewardFunction(config || {
        maxDrawdown: 0.15,
        volatilityPenalty: 0.01,
        positionLimitPenalty: 0.05
      });
    
    case 'profit_factor':
      return new ProfitFactorRewardFunction();
    
    case 'information_ratio':
      return new InformationRatioRewardFunction();
    
    case 'sortino':
      return new SortinoRewardFunction();
    
    default:
      throw new Error(`Unknown reward function type: ${type}`);
  }
} 