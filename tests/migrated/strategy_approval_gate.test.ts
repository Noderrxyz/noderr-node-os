import { StrategyApprovalGate, StrategyApprovalStatus } from '@noderr/governance/src/StrategyApprovalGate';
import { StrategyGenome } from '@noderr/evolution/StrategyGenome';
import { ConductEngine } from '@noderr/governance/src/ConductEngine';
import { TelemetryBus } from '@noderr/telemetry/TelemetryBus';

// Mock dependencies
jest.mock('../../evolution/StrategyGenome');
jest.mock('../../governance/ConductEngine');
jest.mock('../../telemetry/TelemetryBus');
jest.mock('../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

describe('StrategyApprovalGate', () => {
  let approvalGate: StrategyApprovalGate;
  let mockConductEngine: jest.Mocked<ConductEngine>;
  let mockTelemetryBus: jest.Mocked<TelemetryBus>;
  
  // Mock event handlers
  let mockProposalVoteHandler: Function;
  let mockProposalCompletedHandler: Function;
  
  beforeEach(() => {
    // Clear mocks
    jest.clearAllMocks();
    
    // Setup Jest fake timers
    jest.useFakeTimers();
    
    // Mock ConductEngine
    mockConductEngine = {
      getInstance: jest.fn().mockReturnThis(),
      createStrategyProposal: jest.fn().mockResolvedValue({ id: 'proposal_test_123' }),
      on: jest.fn((event, handler) => {
        if (event === 'proposal.vote') {
          mockProposalVoteHandler = handler;
        } else if (event === 'proposal.completed') {
          mockProposalCompletedHandler = handler;
        }
      })
    } as unknown as jest.Mocked<ConductEngine>;
    
    (ConductEngine as any).getInstance = jest.fn().mockReturnValue(mockConductEngine);
    
    // Mock TelemetryBus
    mockTelemetryBus = {
      getInstance: jest.fn().mockReturnThis(),
      emit: jest.fn()
    } as unknown as jest.Mocked<TelemetryBus>;
    
    (TelemetryBus as any).getInstance = jest.fn().mockReturnValue(mockTelemetryBus);
    
    // Create StrategyApprovalGate instance with shorter timeouts for testing
    approvalGate = StrategyApprovalGate.getInstance({
      approvalTimeoutMs: 10000, // 10 seconds for testing
      minRequiredVotingWeight: 10, // Lower for testing
      autoApproveInDevMode: false // Disable auto-approval for testing
    });
  });
  
  afterEach(() => {
    // Restore real timers
    jest.useRealTimers();
  });
  
  test('should be a singleton', () => {
    const instance1 = StrategyApprovalGate.getInstance();
    const instance2 = StrategyApprovalGate.getInstance();
    expect(instance1).toBe(instance2);
  });
  
  test('should request approval for a strategy', async () => {
    // Create mock strategy
    const mockStrategy = {
      getId: jest.fn().mockReturnValue('strategy_123'),
      getName: jest.fn().mockReturnValue('Test Strategy')
    } as unknown as StrategyGenome;
    
    // Request approval
    const status = await approvalGate.requestApproval(mockStrategy);
    
    // Verify
    expect(status).toBe(StrategyApprovalStatus.PENDING);
    expect(mockConductEngine.createStrategyProposal).toHaveBeenCalledWith(
      expect.objectContaining({
        strategyId: 'strategy_123',
        title: 'Strategy Approval: Test Strategy'
      })
    );
    
    expect(mockTelemetryBus.emit).toHaveBeenCalledWith(
      'governance.strategy_approval',
      expect.objectContaining({
        strategyId: 'strategy_123',
        status: StrategyApprovalStatus.PENDING
      })
    );
  });
  
  test('should handle strategy approval through voting', async () => {
    // Create mock strategy
    const mockStrategy = {
      getId: jest.fn().mockReturnValue('strategy_123'),
      getName: jest.fn().mockReturnValue('Test Strategy')
    } as unknown as StrategyGenome;
    
    // Mock callback
    const approvalCallback = jest.fn();
    
    // Request approval
    await approvalGate.requestApproval(mockStrategy, approvalCallback);
    
    // Verify initial state
    expect(approvalGate.getApprovalStatus('strategy_123')).toBe(StrategyApprovalStatus.PENDING);
    
    // Simulate votes
    if (mockProposalVoteHandler) {
      // Send vote with 5 weight
      mockProposalVoteHandler({
        metadata: { strategyId: 'strategy_123' },
        voteType: 'for',
        weight: 5
      });
      
      // Send another vote to reach threshold
      mockProposalVoteHandler({
        metadata: { strategyId: 'strategy_123' },
        voteType: 'for',
        weight: 6
      });
    }
    
    // Verify approval state
    expect(approvalGate.getApprovalStatus('strategy_123')).toBe(StrategyApprovalStatus.APPROVED);
    expect(approvalCallback).toHaveBeenCalledWith(
      StrategyApprovalStatus.APPROVED,
      expect.objectContaining({
        strategyId: 'strategy_123',
        votesFor: 11
      })
    );
  });
  
  test('should handle strategy rejection through voting', async () => {
    // Create mock strategy
    const mockStrategy = {
      getId: jest.fn().mockReturnValue('strategy_123'),
      getName: jest.fn().mockReturnValue('Test Strategy')
    } as unknown as StrategyGenome;
    
    // Mock callback
    const approvalCallback = jest.fn();
    
    // Request approval
    await approvalGate.requestApproval(mockStrategy, approvalCallback);
    
    // Verify initial state
    expect(approvalGate.getApprovalStatus('strategy_123')).toBe(StrategyApprovalStatus.PENDING);
    
    // Simulate votes against
    if (mockProposalVoteHandler) {
      // Send vote with full rejection weight
      mockProposalVoteHandler({
        metadata: { strategyId: 'strategy_123' },
        voteType: 'against',
        weight: 11
      });
    }
    
    // Verify rejection state
    expect(approvalGate.getApprovalStatus('strategy_123')).toBe(StrategyApprovalStatus.REJECTED);
    expect(approvalCallback).toHaveBeenCalledWith(
      StrategyApprovalStatus.REJECTED,
      expect.objectContaining({
        strategyId: 'strategy_123',
        votesAgainst: 11
      })
    );
  });
  
  test('should handle strategy approval through proposal completion', async () => {
    // Create mock strategy
    const mockStrategy = {
      getId: jest.fn().mockReturnValue('strategy_123'),
      getName: jest.fn().mockReturnValue('Test Strategy')
    } as unknown as StrategyGenome;
    
    // Mock callback
    const approvalCallback = jest.fn();
    
    // Request approval
    await approvalGate.requestApproval(mockStrategy, approvalCallback);
    
    // Verify initial state
    expect(approvalGate.getApprovalStatus('strategy_123')).toBe(StrategyApprovalStatus.PENDING);
    
    // Simulate proposal completion
    if (mockProposalCompletedHandler) {
      mockProposalCompletedHandler({
        metadata: { strategyId: 'strategy_123' },
        outcome: 'passed'
      });
    }
    
    // Verify approval state
    expect(approvalGate.getApprovalStatus('strategy_123')).toBe(StrategyApprovalStatus.APPROVED);
    expect(approvalCallback).toHaveBeenCalledWith(
      StrategyApprovalStatus.APPROVED,
      expect.any(Object)
    );
  });
  
  test('should handle strategy rejection through proposal completion', async () => {
    // Create mock strategy
    const mockStrategy = {
      getId: jest.fn().mockReturnValue('strategy_123'),
      getName: jest.fn().mockReturnValue('Test Strategy')
    } as unknown as StrategyGenome;
    
    // Mock callback
    const approvalCallback = jest.fn();
    
    // Request approval
    await approvalGate.requestApproval(mockStrategy, approvalCallback);
    
    // Verify initial state
    expect(approvalGate.getApprovalStatus('strategy_123')).toBe(StrategyApprovalStatus.PENDING);
    
    // Simulate proposal completion
    if (mockProposalCompletedHandler) {
      mockProposalCompletedHandler({
        metadata: { strategyId: 'strategy_123' },
        outcome: 'rejected'
      });
    }
    
    // Verify approval state
    expect(approvalGate.getApprovalStatus('strategy_123')).toBe(StrategyApprovalStatus.REJECTED);
    expect(approvalCallback).toHaveBeenCalledWith(
      StrategyApprovalStatus.REJECTED,
      expect.any(Object)
    );
  });
  
  test('should handle manual approval', async () => {
    // Create mock strategy
    const mockStrategy = {
      getId: jest.fn().mockReturnValue('strategy_123'),
      getName: jest.fn().mockReturnValue('Test Strategy')
    } as unknown as StrategyGenome;
    
    // Mock callback
    const approvalCallback = jest.fn();
    
    // Request approval
    await approvalGate.requestApproval(mockStrategy, approvalCallback);
    
    // Verify initial state
    expect(approvalGate.getApprovalStatus('strategy_123')).toBe(StrategyApprovalStatus.PENDING);
    
    // Manually approve
    const success = approvalGate.approveStrategy('strategy_123', 'admin_user', 'Manually approved for testing');
    
    // Verify
    expect(success).toBe(true);
    expect(approvalGate.getApprovalStatus('strategy_123')).toBe(StrategyApprovalStatus.APPROVED);
    expect(approvalCallback).toHaveBeenCalledWith(
      StrategyApprovalStatus.APPROVED,
      expect.objectContaining({
        comments: expect.arrayContaining([
          expect.objectContaining({
            author: 'admin_user',
            text: 'Manually approved for testing'
          })
        ])
      })
    );
  });
  
  test('should handle manual rejection', async () => {
    // Create mock strategy
    const mockStrategy = {
      getId: jest.fn().mockReturnValue('strategy_123'),
      getName: jest.fn().mockReturnValue('Test Strategy')
    } as unknown as StrategyGenome;
    
    // Mock callback
    const approvalCallback = jest.fn();
    
    // Request approval
    await approvalGate.requestApproval(mockStrategy, approvalCallback);
    
    // Verify initial state
    expect(approvalGate.getApprovalStatus('strategy_123')).toBe(StrategyApprovalStatus.PENDING);
    
    // Manually reject
    const success = approvalGate.rejectStrategy('strategy_123', 'admin_user', 'Strategy too risky');
    
    // Verify
    expect(success).toBe(true);
    expect(approvalGate.getApprovalStatus('strategy_123')).toBe(StrategyApprovalStatus.REJECTED);
    expect(approvalCallback).toHaveBeenCalledWith(
      StrategyApprovalStatus.REJECTED,
      expect.objectContaining({
        comments: expect.arrayContaining([
          expect.objectContaining({
            author: 'admin_user',
            text: 'Rejected: Strategy too risky'
          })
        ])
      })
    );
  });
  
  test('should handle expiration of approvals', async () => {
    // Create mock strategy
    const mockStrategy = {
      getId: jest.fn().mockReturnValue('strategy_123'),
      getName: jest.fn().mockReturnValue('Test Strategy')
    } as unknown as StrategyGenome;
    
    // Mock callback
    const approvalCallback = jest.fn();
    
    // Request approval
    await approvalGate.requestApproval(mockStrategy, approvalCallback);
    
    // Verify initial state
    expect(approvalGate.getApprovalStatus('strategy_123')).toBe(StrategyApprovalStatus.PENDING);
    
    // Fast forward past expiration
    jest.advanceTimersByTime(11000); // 11 seconds
    
    // Trigger timeout check (private method called by interval)
    // We'll use reflection to call it directly for testing
    const checkTimeouts = (approvalGate as any).startExpirationChecker;
    checkTimeouts.call(approvalGate);
    
    // Verify expiration
    expect(approvalGate.getApprovalStatus('strategy_123')).toBe(StrategyApprovalStatus.EXPIRED);
    expect(approvalCallback).toHaveBeenCalledWith(
      StrategyApprovalStatus.EXPIRED,
      expect.any(Object)
    );
  });
  
  test('should get pending strategy IDs', async () => {
    // Create mock strategies
    const mockStrategy1 = {
      getId: jest.fn().mockReturnValue('strategy_123'),
      getName: jest.fn().mockReturnValue('Test Strategy 1')
    } as unknown as StrategyGenome;
    
    const mockStrategy2 = {
      getId: jest.fn().mockReturnValue('strategy_456'),
      getName: jest.fn().mockReturnValue('Test Strategy 2')
    } as unknown as StrategyGenome;
    
    // Request approvals
    await approvalGate.requestApproval(mockStrategy1);
    await approvalGate.requestApproval(mockStrategy2);
    
    // Approve one
    approvalGate.approveStrategy('strategy_123', 'admin_user');
    
    // Get pending strategies
    const pendingIds = approvalGate.getPendingStrategyIds();
    
    // Verify only the unapproved one is pending
    expect(pendingIds).toHaveLength(1);
    expect(pendingIds[0]).toBe('strategy_456');
  });
}); 