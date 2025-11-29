import { jest } from '@jest/globals';
import { PostgresService } from '../PostgresService';
import { DataPipelineService, DataPoint } from '../DataPipelineService';
import { DataPipelineManager } from '../DataPipelineManager';
import { PoolClient, QueryResult } from 'pg';

// Mock types
type MockQueryResult = {
  rows: any[];
  command: string;
  rowCount: number;
  oid: number;
  fields: any[];
};

type MockPoolClient = {
  query: jest.Mock<Promise<MockQueryResult>>;
  release: jest.Mock<void>;
};

// Mock PostgresService
jest.mock('../PostgresService');

describe('DataPipelineService', () => {
  let postgresService: PostgresService;
  let dataPipelineService: DataPipelineService;

  beforeEach(() => {
    postgresService = new PostgresService();
    dataPipelineService = DataPipelineService.getInstance(postgresService);

    // Setup mock implementations
    (postgresService.initialize as jest.Mock).mockResolvedValue(undefined);
    (postgresService.getClient as jest.Mock).mockResolvedValue({
      query: jest.fn().mockResolvedValue({ rows: [] } as QueryResult),
      release: jest.fn()
    } as PoolClient);
    (postgresService.query as jest.Mock).mockResolvedValue({ rows: [] } as QueryResult);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('initialize', () => {
    it('should initialize successfully', async () => {
      await expect(dataPipelineService.initialize()).resolves.not.toThrow();
    });
  });

  describe('processDataPoint', () => {
    it('should process a single data point', async () => {
      await dataPipelineService.initialize();

      const dataPoint: DataPoint = {
        timestamp: new Date(),
        symbol: 'BTC/USDT',
        price: 50000,
        volume: 100,
        liquidity: 1000000,
        volatility: 0.02
      };

      await expect(dataPipelineService.processDataPoint(dataPoint)).resolves.not.toThrow();
    });

    it('should throw error if not initialized', async () => {
      const dataPoint: DataPoint = {
        timestamp: new Date(),
        symbol: 'BTC/USDT',
        price: 50000,
        volume: 100,
        liquidity: 1000000,
        volatility: 0.02
      };

      await expect(dataPipelineService.processDataPoint(dataPoint)).rejects.toThrow('Data pipeline not initialized');
    });
  });

  describe('processDataPoints', () => {
    it('should process multiple data points', async () => {
      await dataPipelineService.initialize();

      const dataPoints: DataPoint[] = [
        {
          timestamp: new Date(),
          symbol: 'BTC/USDT',
          price: 50000,
          volume: 100,
          liquidity: 1000000,
          volatility: 0.02
        },
        {
          timestamp: new Date(),
          symbol: 'ETH/USDT',
          price: 3000,
          volume: 50,
          liquidity: 500000,
          volatility: 0.03
        }
      ];

      await expect(dataPipelineService.processDataPoints(dataPoints)).resolves.not.toThrow();
    });
  });
});

describe('DataPipelineManager', () => {
  let postgresService: PostgresService;
  let dataPipelineManager: DataPipelineManager;

  beforeEach(() => {
    postgresService = new PostgresService();
    dataPipelineManager = DataPipelineManager.getInstance(postgresService);

    // Setup mock implementations
    (postgresService.initialize as jest.Mock).mockResolvedValue(undefined);
    (postgresService.getClient as jest.Mock).mockResolvedValue({
      query: jest.fn().mockResolvedValue({ rows: [] } as QueryResult),
      release: jest.fn()
    } as PoolClient);
    (postgresService.query as jest.Mock).mockResolvedValue({ rows: [] } as QueryResult);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('initialize', () => {
    it('should initialize successfully', async () => {
      await expect(dataPipelineManager.initialize()).resolves.not.toThrow();
    });
  });

  describe('processData', () => {
    it('should process data through the pipeline', async () => {
      await dataPipelineManager.initialize();

      const dataPoints: DataPoint[] = [
        {
          timestamp: new Date(),
          symbol: 'BTC/USDT',
          price: 50000,
          volume: 100,
          liquidity: 1000000,
          volatility: 0.02
        },
        {
          timestamp: new Date(),
          symbol: 'ETH/USDT',
          price: 3000,
          volume: 50,
          liquidity: 500000,
          volatility: 0.03
        }
      ];

      const result = await dataPipelineManager.processData(dataPoints);
      expect(result.success).toBe(true);
      expect(result.processedCount).toBe(2);
      expect(result.errorCount).toBe(0);
    });

    it('should validate data points', async () => {
      await dataPipelineManager.initialize();

      const invalidDataPoints: DataPoint[] = [
        {
          timestamp: new Date(),
          symbol: 'BTC/USDT',
          price: NaN,
          volume: 100,
          liquidity: 1000000,
          volatility: 0.02
        }
      ];

      const result = await dataPipelineManager.processData(invalidDataPoints);
      expect(result.success).toBe(false);
      expect(result.errorCount).toBe(1);
      expect(result.errors).toHaveLength(1);
    });

    it('should throw error if not initialized', async () => {
      const dataPoints: DataPoint[] = [
        {
          timestamp: new Date(),
          symbol: 'BTC/USDT',
          price: 50000,
          volume: 100,
          liquidity: 1000000,
          volatility: 0.02
        }
      ];

      await expect(dataPipelineManager.processData(dataPoints)).rejects.toThrow('Pipeline manager not initialized');
    });

    it('should throw error if max concurrent pipelines reached', async () => {
      await dataPipelineManager.initialize();

      // Mock activePipelines to simulate max concurrent pipelines
      (dataPipelineManager as any).activePipelines = 5;

      const dataPoints: DataPoint[] = [
        {
          timestamp: new Date(),
          symbol: 'BTC/USDT',
          price: 50000,
          volume: 100,
          liquidity: 1000000,
          volatility: 0.02
        }
      ];

      await expect(dataPipelineManager.processData(dataPoints)).rejects.toThrow('Maximum number of concurrent pipelines reached');
    });
  });
}); 