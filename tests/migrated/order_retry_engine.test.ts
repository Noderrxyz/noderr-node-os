import { OrderRetryEngine, RetryContext } from '@noderr/execution/src/OrderRetryEngine';
import { TrustManager } from '@noderr/governance/src/TrustManager';
import fs from 'fs';
import path from 'path';

describe('OrderRetryEngine', () => {
  let retryEngine: OrderRetryEngine;
  let trustManager: TrustManager;
  const testLogPath = path.join(process.cwd(), 'test_logs', 'retry_log.jsonl');

  beforeEach(() => {
    // Create test log directory
    const logDir = path.dirname(testLogPath);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }

    // Initialize with test config
    retryEngine = OrderRetryEngine.getInstance({
      logFilePath: testLogPath,
      maxRetries: 3,
      baseDelayMs: 100,
      maxDelayMs: 1000
    });

    trustManager = TrustManager.getInstance();
  });

  afterEach(() => {
    // Cleanup test files
    if (fs.existsSync(testLogPath)) {
      fs.unlinkSync(testLogPath);
    }
    retryEngine.cleanup();
    trustManager.cleanup();
  });

  describe('retry logic', () => {
    it('should retry with exponential backoff', async () => {
      const startTime = Date.now();
      const context: RetryContext = {
        symbol: 'ETH/USD',
        venue: 'binance',
        reason: 'slippageTooHigh',
        attempt: 0,
        maxRetries: 3
      };

      const result = await retryEngine.retry(context);
      const endTime = Date.now();
      const elapsed = endTime - startTime;

      expect(result).toBe(true);
      expect(elapsed).toBeGreaterThanOrEqual(100); // baseDelayMs
      expect(elapsed).toBeLessThan(200); // Should be close to baseDelayMs
    });

    it('should stop after max retries', async () => {
      const context: RetryContext = {
        symbol: 'ETH/USD',
        venue: 'binance',
        reason: 'slippageTooHigh',
        attempt: 3,
        maxRetries: 3
      };

      const result = await retryEngine.retry(context);
      expect(result).toBe(false);
    });
  });

  describe('venue rotation', () => {
    it('should rotate to next venue when available', async () => {
      const context: RetryContext = {
        symbol: 'ETH/USD',
        venue: 'binance',
        reason: 'slippageTooHigh',
        attempt: 0,
        maxRetries: 3,
        availableVenues: ['binance', 'coinbase', 'kraken']
      };

      await retryEngine.retry(context);
      expect(context.venue).toBe('coinbase');
    });

    it('should not rotate when only one venue available', async () => {
      const context: RetryContext = {
        symbol: 'ETH/USD',
        venue: 'binance',
        reason: 'slippageTooHigh',
        attempt: 0,
        maxRetries: 3,
        availableVenues: ['binance']
      };

      await retryEngine.retry(context);
      expect(context.venue).toBe('binance');
    });
  });

  describe('logging', () => {
    it('should log retry attempts', async () => {
      const context: RetryContext = {
        symbol: 'ETH/USD',
        venue: 'binance',
        reason: 'slippageTooHigh',
        attempt: 0,
        maxRetries: 3
      };

      await retryEngine.retry(context);

      const logContent = fs.readFileSync(testLogPath, 'utf8');
      const logEntry = JSON.parse(logContent.trim());

      expect(logEntry.symbol).toBe('ETH/USD');
      expect(logEntry.venue).toBe('binance');
      expect(logEntry.reason).toBe('slippageTooHigh');
      expect(logEntry.attempt).toBe(0);
      expect(logEntry.success).toBe(false);
      expect(logEntry.timestamp).toBeDefined();
    });
  });

  describe('trust management', () => {
    it('should decay trust after max retries', async () => {
      const venue = 'binance';
      const initialTrust = trustManager.getTrustScore(venue);

      const context: RetryContext = {
        symbol: 'ETH/USD',
        venue,
        reason: 'slippageTooHigh',
        attempt: 3,
        maxRetries: 3
      };

      await retryEngine.retry(context);
      const finalTrust = trustManager.getTrustScore(venue);

      expect(finalTrust).toBeLessThan(initialTrust);
    });
  });
}); 