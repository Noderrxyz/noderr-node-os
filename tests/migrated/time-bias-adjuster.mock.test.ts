/**
 * TimeOfDayBiasAdjuster Demo Script
 * 
 * This script demonstrates how the time-of-day bias adjuster works by simulating
 * a day of trading with different performance across different hours.
 */

import { TimeOfDayBiasAdjuster } from './time-bias-adjuster';
import { FusedAlphaFrame } from './fusion-engine';
import { SignalDirection } from './fusion-engine';

// Mock for logger
jest.mock('../common/logger', () => ({
  createLogger: () => ({
    info: console.log,
    debug: console.log,
    warn: console.warn,
    error: console.error
  })
}));

/**
 * Run a simple demonstration of time-of-day bias adjustment
 */
function runTimeBiasDemo() {
  console.log('===== Time-of-Day Bias Adjuster Demo =====');
  
  // Create a bias adjuster with lower thresholds for demo
  const adjuster = new TimeOfDayBiasAdjuster({
    minDataPoints: 3,      // Only need 3 data points to start using bias
    smoothing: 0.3,        // Faster adaptation to new data
    logDetailedAdjustments: true
  });
  
  // Create a set of fake symbols
  const symbols = ['BTC/USDC', 'ETH/USDC', 'SOL/USDC'];
  
  // Define hour performance patterns
  // Positive values = good trading times
  // Negative values = bad trading times
  const hourlyPerformance: Record<number, number> = {
    // Morning hours (best performance)
    9: 0.5,
    10: 0.6,
    11: 0.4,
    
    // Mid-day (average performance)
    12: 0.1,
    13: 0.2,
    14: 0.3,
    
    // Afternoon (poor performance)
    15: -0.1,
    16: -0.2,
    17: -0.3,
    
    // Evening (worst performance)
    18: -0.4,
    19: -0.5,
    20: -0.6
  };
  
  // Helper to create a signal at a specific hour
  const createSignal = (symbol: string, hour: number): FusedAlphaFrame => {
    const date = new Date();
    date.setHours(hour, 0, 0, 0);
    
    return {
      symbol,
      direction: SignalDirection.LONG,
      confidence: 0.8,  // Start with high confidence
      size: 0.5,
      sources: ['test-source'],
      details: [],
      timestamp: date.getTime()
    };
  };
  
  // Simulate 5 days of trading
  for (let day = 1; day <= 5; day++) {
    console.log(`\n--- Day ${day} ---`);
    
    // For each hour in our performance map
    for (const [hourStr, performance] of Object.entries(hourlyPerformance)) {
      const hour = parseInt(hourStr, 10);
      
      // For each symbol
      for (const symbol of symbols) {
        // Create a signal for this hour
        const signal = createSignal(symbol, hour);
        
        // Apply bias adjustment
        const adjusted = adjuster.adjustSignal(signal);
        
        // Show the adjustment only on day 5 (after learning)
        if (day === 5) {
          console.log(
            `Hour ${hour}: ${symbol} confidence ${signal.confidence.toFixed(2)} → ` +
            `${adjusted.confidence.toFixed(2)} (factor: ${adjusted.metadata?.timeBiasFactor?.toFixed(2) || '1.00'})`
          );
        }
        
        // Record outcome (add a little randomness)
        const randomFactor = Math.random() * 0.2 - 0.1; // -0.1 to +0.1
        const outcome = performance + randomFactor;
        
        // Record the outcome
        adjuster.recordOutcome(adjusted, outcome);
      }
    }
  }
  
  // Show final stats
  console.log('\n=== Final Time Bucket Statistics ===');
  const stats = adjuster.getBucketStats();
  
  // Group by hour for display
  const hourStats: Record<number, {
    signalCount: number;
    meanOutcome: number;
    biasFactor: number;
  }> = {};
  
  for (const [bucketStr, bucket] of stats.entries()) {
    const bucket_num = parseInt(bucketStr, 10);
    const hour = Math.floor((bucket_num * 60) / 60);
    
    if (hourlyPerformance[hour] !== undefined) {
      hourStats[hour] = {
        signalCount: bucket.signalCount,
        meanOutcome: bucket.meanOutcome,
        biasFactor: bucket.biasFactor
      };
    }
  }
  
  // Display hours in order
  const orderedHours = Object.keys(hourStats).map(h => parseInt(h, 10)).sort((a, b) => a - b);
  
  for (const hour of orderedHours) {
    const stat = hourStats[hour];
    console.log(
      `Hour ${hour}:\tSignals: ${stat.signalCount}\tMean Outcome: ${stat.meanOutcome.toFixed(3)}\t` +
      `Bias Factor: ${stat.biasFactor.toFixed(2)}`
    );
  }
  
  console.log('\n===== Demo Complete =====');
}

// Run the demo if this is executed directly
if (require.main === module) {
  runTimeBiasDemo();
}

export { runTimeBiasDemo }; 