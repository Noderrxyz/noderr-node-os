import { RegimeDashboard } from '@noderr/telemetry/dashboards/RegimeDashboard';
import { TelemetryBus } from '@noderr/telemetry/TelemetryBus';
import { MarketRegimeClassifier } from '@noderr/regime/MarketRegimeClassifier';
import { RegimeTransitionEngine } from '@noderr/regime/RegimeTransitionEngine';
import { MarketRegime, RegimeTransitionState } from '@noderr/regime/MarketRegimeTypes';

// Mock dependencies
jest.mock('../../telemetry/TelemetryBus');
jest.mock('../../regime/MarketRegimeClassifier');
jest.mock('../../regime/RegimeTransitionEngine');
jest.mock('../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

describe('RegimeDashboard', () => {
  let dashboard: RegimeDashboard;
  let mockTelemetryBus: jest.Mocked<TelemetryBus>;
  let mockRegimeClassifier: jest.Mocked<MarketRegimeClassifier>;
  let mockTransitionEngine: jest.Mocked<RegimeTransitionEngine>;
  
  // Store callbacks registered with the TransitionEngine
  let transitionCallback: Function;
  let classificationCallback: Function;
  
  beforeEach(() => {
    // Clear mocks
    jest.clearAllMocks();
    
    // Set up mock implementations
    mockTelemetryBus = {
      getInstance: jest.fn().mockReturnThis(),
      emit: jest.fn(),
      on: jest.fn()
    } as unknown as jest.Mocked<TelemetryBus>;
    
    (TelemetryBus as any).getInstance = jest.fn().mockReturnValue(mockTelemetryBus);
    
    mockRegimeClassifier = {
      getInstance: jest.fn().mockReturnThis(),
      getCurrentRegime: jest.fn().mockImplementation((symbol: string) => {
        if (symbol === 'BTC/USD') {
          return {
            primaryRegime: MarketRegime.Bull,
            secondaryRegime: MarketRegime.Sideways,
            confidence: 0.85,
            transitionState: RegimeTransitionState.Stable,
            timestamp: Date.now(),
            features: {
              volatility20d: 0.25,
              returns5d: 0.05
            }
          };
        }
        return null;
      }),
      getRegimeHistory: jest.fn().mockImplementation((symbol: string) => {
        if (symbol === 'BTC/USD') {
          return {
            transitions: [
              {
                fromRegime: MarketRegime.Sideways,
                toRegime: MarketRegime.Bull,
                confidence: 0.8,
                detectedAt: Date.now() - 86400000, // 1 day ago
                transitionDurationMs: 3600000 // 1 hour
              }
            ]
          };
        }
        return null;
      })
    } as unknown as jest.Mocked<MarketRegimeClassifier>;
    
    (MarketRegimeClassifier as any).getInstance = jest.fn().mockReturnValue(mockRegimeClassifier);
    
    mockTransitionEngine = {
      getInstance: jest.fn().mockReturnThis(),
      onTransition: jest.fn().mockImplementation((callback) => {
        transitionCallback = callback;
        return mockTransitionEngine;
      }),
      onClassification: jest.fn().mockImplementation((callback) => {
        classificationCallback = callback;
        return mockTransitionEngine;
      })
    } as unknown as jest.Mocked<RegimeTransitionEngine>;
    
    (RegimeTransitionEngine as any).getInstance = jest.fn().mockReturnValue(mockTransitionEngine);
    
    // Create dashboard instance with detailed logging enabled for testing
    dashboard = RegimeDashboard.getInstance({
      port: 9999,
      enableDetailedLogs: true,
      defaultSymbols: ['BTC/USD', 'ETH/USD']
    });
  });
  
  test('should be a singleton', () => {
    const instance1 = RegimeDashboard.getInstance();
    const instance2 = RegimeDashboard.getInstance();
    
    expect(instance1).toBe(instance2);
  });
  
  test('should initialize with default symbols', () => {
    expect(mockRegimeClassifier.getCurrentRegime).toHaveBeenCalledWith('BTC/USD');
    expect(mockRegimeClassifier.getCurrentRegime).toHaveBeenCalledWith('ETH/USD');
  });
  
  test('should start and stop the dashboard server', async () => {
    // Start the server
    const startResult = await dashboard.start();
    expect(startResult).toBe(true);
    
    // Verify the subscription to transitions was set up
    expect(mockTransitionEngine.onTransition).toHaveBeenCalled();
    expect(mockTransitionEngine.onClassification).toHaveBeenCalled();
    
    // Stop the server
    dashboard.stop();
  });
  
  test('should handle new client connections', () => {
    const mockClient = {};
    const mockRequest = { socket: { remoteAddress: '127.0.0.1' } };
    
    dashboard.handleConnection(mockClient, mockRequest);
    
    // Should have created a client with the default symbols
    const clients = (dashboard as any).clients;
    expect(clients.size).toBe(1);
    
    const clientEntry = Array.from(clients.values())[0];
    expect(clientEntry.subscribedSymbols.has('BTC/USD')).toBe(true);
    expect(clientEntry.subscribedSymbols.has('ETH/USD')).toBe(true);
  });
  
  test('should handle regime transitions', async () => {
    // Start the dashboard
    await dashboard.start();
    
    // Simulate a transition event
    const transitionEvent = {
      fromRegime: MarketRegime.Sideways,
      toRegime: MarketRegime.Bull,
      confidence: 0.9,
      detectedAt: Date.now(),
      transitionDurationMs: 3600000 // 1 hour
    };
    
    // Call the transition callback
    transitionCallback(transitionEvent, 'BTC/USD');
    
    // Check that the transition was added to the dashboard state
    const dashboardState = (dashboard as any).dashboardState;
    const btcState = dashboardState.get('BTC/USD');
    
    expect(btcState).toBeDefined();
    expect(btcState.currentRegime).toBe(MarketRegime.Bull);
    expect(btcState.transitions.length).toBeGreaterThan(0);
    
    // The most recent transition should match our event
    const latestTransition = btcState.transitions[btcState.transitions.length - 1];
    expect(latestTransition.fromRegime).toBe(MarketRegime.Sideways);
    expect(latestTransition.toRegime).toBe(MarketRegime.Bull);
    expect(latestTransition.confidence).toBe(0.9);
    
    // Stop the dashboard
    dashboard.stop();
  });
  
  test('should handle regime classifications', async () => {
    // Start the dashboard
    await dashboard.start();
    
    // Simulate a classification event
    const classificationEvent = {
      primaryRegime: MarketRegime.Bull,
      secondaryRegime: MarketRegime.Volatile,
      confidence: 0.75,
      transitionState: RegimeTransitionState.Emerging,
      timestamp: Date.now(),
      features: {
        volatility20d: 0.3,
        returns5d: 0.08
      }
    };
    
    // Call the classification callback
    classificationCallback(classificationEvent, 'ETH/USD');
    
    // Check that the classification was added to the dashboard state
    const dashboardState = (dashboard as any).dashboardState;
    const ethState = dashboardState.get('ETH/USD');
    
    expect(ethState).toBeDefined();
    expect(ethState.currentRegime).toBe(MarketRegime.Bull);
    expect(ethState.confidence).toBe(0.75);
    expect(ethState.transitionState).toBe(RegimeTransitionState.Emerging);
    expect(ethState.historyPoints.length).toBeGreaterThan(0);
    
    // The most recent data point should match our event
    const latestPoint = ethState.historyPoints[ethState.historyPoints.length - 1];
    expect(latestPoint.primaryRegime).toBe(MarketRegime.Bull);
    expect(latestPoint.secondaryRegime).toBe(MarketRegime.Volatile);
    expect(latestPoint.volatility).toBe(0.3);
    expect(latestPoint.returns).toBe(0.08);
    
    // Stop the dashboard
    dashboard.stop();
  });
  
  test('should format symbol state for clients', () => {
    // Create dashboard state
    const dashboardState = (dashboard as any).dashboardState;
    const btcState = dashboardState.get('BTC/USD');
    
    // Format the state
    const formattedState = (dashboard as any).formatSymbolState(btcState);
    
    // Check the format
    expect(formattedState).toHaveProperty('symbol', 'BTC/USD');
    expect(formattedState).toHaveProperty('currentRegime');
    expect(formattedState).toHaveProperty('confidence');
    expect(formattedState).toHaveProperty('transitionState');
    expect(formattedState).toHaveProperty('history');
    expect(formattedState).toHaveProperty('transitions');
    expect(formattedState).toHaveProperty('lastUpdated');
    
    // History should be limited
    expect(formattedState.history.length).toBeLessThanOrEqual(50);
    expect(formattedState.transitions.length).toBeLessThanOrEqual(10);
  });
  
  test('should provide dashboard overview', () => {
    // Get dashboard overview
    const overview = (dashboard as any).getDashboardOverview();
    
    // Check the overview format
    expect(overview).toHaveProperty('symbolCount');
    expect(overview).toHaveProperty('regimeCounts');
    expect(overview).toHaveProperty('transitionCounts');
    expect(overview).toHaveProperty('clientCount');
    expect(overview).toHaveProperty('timestamp');
    
    // Should have at least the default symbols
    expect(overview.symbolCount).toBeGreaterThanOrEqual(2);
  });
  
  test('should clean up inactive clients', () => {
    // Add a mock client
    const mockClient = {
      id: 'test-client',
      send: jest.fn(),
      subscribedSymbols: new Set(['BTC/USD']),
      lastActive: Date.now() - 50000, // 50 seconds ago
      ip: '127.0.0.1'
    };
    
    const clients = (dashboard as any).clients;
    clients.set(mockClient.id, mockClient);
    
    // Set a shorter timeout for testing
    (dashboard as any).config.wsTimeoutMs = 30000; // 30 seconds
    
    // Run cleanup
    (dashboard as any).cleanupInactiveClients();
    
    // Client should be removed
    expect(clients.has(mockClient.id)).toBe(false);
  });
  
  test('should broadcast symbol updates', () => {
    // Add a mock client
    const mockClient = {
      id: 'test-client',
      send: jest.fn(),
      subscribedSymbols: new Set(['BTC/USD']),
      lastActive: Date.now(),
      ip: '127.0.0.1'
    };
    
    const clients = (dashboard as any).clients;
    clients.set(mockClient.id, mockClient);
    
    // Broadcast update
    (dashboard as any).broadcastSymbolUpdate('BTC/USD');
    
    // Client should receive the update
    expect(mockClient.send).toHaveBeenCalled();
    
    // The message should be a JSON string
    const callArg = mockClient.send.mock.calls[0][0];
    const parsed = JSON.parse(callArg);
    
    expect(parsed.type).toBe('symbol_update');
    expect(parsed.data.symbol).toBe('BTC/USD');
  });
}); 