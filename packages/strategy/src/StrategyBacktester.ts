import * as path from 'path';
import { Logger } from '@noderr/utils';

const logger = new Logger('StrategyBacktester');

/**
 * Mock Strategy Backtester for Testnet Simulation.
 * In a real-world scenario, this would interface with the `quant-research` package
 * to run a full historical backtest, including slippage, fees, and market impact models.
 *
 * For the testnet ingestion pipeline, we simulate a successful backtest and return
 * key performance indicators (KPIs) that would be used for reputation scoring.
 *
 * @param strategyPath The absolute path to the cloned strategy directory.
 * @returns A promise that resolves with mock backtest results.
 */
export async function runInitialBacktest(
    strategyPath: string,
    options?: { deterministic?: boolean }
): Promise<{
    sharpeRatio: number;
    maxDrawdown: number;
    annualizedReturn: number;
    backtestFile: string;
}> {
    logger.info('Running initial backtest for strategy', { strategyPath });

    // MEDIUM FIX #18: Make results deterministic for testing when requested
    // In testnet mode, use deterministic values; in production, these would come from real backtests
    const isDeterministic = options?.deterministic ?? true; // Default to deterministic for testnet
    
    const mockResults = {
        sharpeRatio: isDeterministic ? 2.75 : 2.5 + Math.random() * 0.5, // Target: >2.0
        maxDrawdown: isDeterministic ? 0.035 : 0.03 + Math.random() * 0.01, // Target: <5% (0.05)
        annualizedReturn: isDeterministic ? 0.18 : 0.15 + Math.random() * 0.05, // Target: 8-12% (0.08-0.12)
        backtestFile: path.join(strategyPath, 'backtest_report.json'),
    };

    // Simulate the time taken for a comprehensive backtest
    await new Promise(resolve => setTimeout(resolve, 1000));

    logger.info('Backtest complete', { 
        sharpeRatio: mockResults.sharpeRatio.toFixed(2),
        maxDrawdown: mockResults.maxDrawdown.toFixed(4),
        annualizedReturn: mockResults.annualizedReturn.toFixed(4)
    });

    // Institutional-grade check: Reject strategies that don't meet minimum performance
    if (mockResults.sharpeRatio < 1.5 || mockResults.maxDrawdown > 0.10) {
        throw new Error('Backtest failed to meet minimum institutional performance thresholds (Sharpe < 1.5 or Drawdown > 10%).');
    }

    return mockResults;
}
