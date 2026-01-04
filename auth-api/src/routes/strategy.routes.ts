/**
 * Strategy Submission API Routes
 * 
 * Handles strategy submissions from the dApp, integrates with:
 * - Guardian consensus for review
 * - Backtesting framework for validation
 * - On-chain strategy registry
 * 
 * NOTE: This is a standalone version for Railway deployment.
 * Guardian consensus and backtesting are stubbed for testnet.
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { createHash } from 'crypto';
import { EventEmitter } from 'events';

// In-memory storage for testnet (use database in production)
const submissions = new Map<string, StrategySubmission>();
const userSubmissions = new Map<string, string[]>(); // address -> submissionIds

// Stubbed Strategy Review Service for standalone deployment
class StrategyReviewService extends EventEmitter {
  private pendingReviews: StrategyReviewRequest[] = [];
  private config: { minReviewers: number; approvalThreshold: number; reviewTimeout: number };

  constructor(config: { minReviewers: number; approvalThreshold: number; reviewTimeout: number }) {
    super();
    this.config = config;
  }

  async submitForReview(request: StrategyReviewRequest): Promise<void> {
    this.pendingReviews.push(request);
    
    // For testnet, auto-approve after a delay to simulate review process
    setTimeout(() => {
      this.emit('strategy_approved', {
        strategyId: request.strategyId,
        consensus: {
          approvalRate: 0.8,
          totalReviews: 3,
          averageRiskScore: 5,
          consensusTime: Date.now(),
        },
      });
      this.pendingReviews = this.pendingReviews.filter(r => r.strategyId !== request.strategyId);
    }, 5000); // 5 second delay for testnet
  }

  getPendingReviews(): StrategyReviewRequest[] {
    return this.pendingReviews;
  }
}

interface StrategyReviewRequest {
  strategyId: string;
  name: string;
  description: string;
  category: string;
  riskLevel: string;
  expectedApy: number;
  codeUrl: string;
  submitterAddress: string;
  backtestResults?: {
    sharpeRatio: number;
    maxDrawdown: number;
    winRate: number;
    totalTrades: number;
    annualizedReturn: number;
  };
}

// Strategy Review Service instance
const reviewService = new StrategyReviewService({
  minReviewers: 3, // Reduced for testnet
  approvalThreshold: 0.6, // 60% approval required
  reviewTimeout: 24 * 60 * 60 * 1000, // 24 hours for testnet
});

// Simple logger using Fastify's built-in logger
const createLogger = () => ({
  info: (message: string, meta?: Record<string, unknown>) => console.log(`[INFO] ${message}`, meta || ''),
  warn: (message: string, meta?: Record<string, unknown>) => console.warn(`[WARN] ${message}`, meta || ''),
  error: (message: string, meta?: Record<string, unknown>) => console.error(`[ERROR] ${message}`, meta || ''),
});

const logger = createLogger();

// Types
interface StrategySubmission {
  submissionId: string;
  strategyId: string;
  submitterAddress: string;
  name: string;
  description: string;
  category: string;
  riskLevel: string;
  expectedApy: number;
  performanceFee: number;
  codeUrl: string;
  backtestResults?: string;
  stakeAmount: string;
  status: StrategyStatus;
  submittedAt: Date;
  updatedAt: Date;
  validationResult?: ValidationResult;
  reviewResult?: ReviewResult;
  onChainId?: string;
}

type StrategyStatus = 
  | 'pending'
  | 'validating'
  | 'under_review'
  | 'approved'
  | 'rejected'
  | 'deployed'
  | 'active'
  | 'paused'
  | 'terminated';

interface ValidationResult {
  passed: boolean;
  score: number;
  backtestMetrics?: {
    sharpeRatio: number;
    maxDrawdown: number;
    winRate: number;
    totalTrades: number;
    annualizedReturn: number;
  };
  securityChecks?: {
    noHardcodedKeys: boolean;
    hasErrorHandling: boolean;
    hasRiskManagement: boolean;
  };
  feedback?: string;
}

interface ReviewResult {
  approved: boolean;
  approvalRate: number;
  totalReviews: number;
  averageRiskScore: number;
  concerns: string[];
  consensusTime: Date;
}

// Request schemas
const StrategySubmissionSchema = z.object({
  submitterAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  name: z.string().min(3).max(100),
  description: z.string().min(10).max(2000),
  category: z.enum(['arbitrage', 'market-making', 'trend-following', 'mean-reversion', 'volatility', 'delta-neutral', 'other']),
  riskLevel: z.enum(['low', 'medium', 'high']),
  expectedApy: z.number().min(0).max(200),
  performanceFee: z.number().min(10).max(25),
  codeUrl: z.string().url(),
  backtestResults: z.string().optional(),
  stakeAmount: z.string(),
});

export async function registerStrategyRoutes(fastify: FastifyInstance) {
  // Listen for review service events
  reviewService.on('strategy_approved', async (data) => {
    const submission = Array.from(submissions.values()).find(
      s => s.strategyId === data.strategyId
    );
    
    if (submission) {
      submission.status = 'approved';
      submission.updatedAt = new Date();
      submission.reviewResult = {
        approved: true,
        approvalRate: data.consensus.approvalRate,
        totalReviews: data.consensus.totalReviews,
        averageRiskScore: data.consensus.averageRiskScore,
        concerns: [],
        consensusTime: new Date(data.consensus.consensusTime),
      };
      
      logger.info('Strategy approved', { submissionId: submission.submissionId });
      
      // TODO: Register on-chain
    }
  });
  
  reviewService.on('strategy_rejected', async (data) => {
    const submission = Array.from(submissions.values()).find(
      s => s.strategyId === data.strategyId
    );
    
    if (submission) {
      submission.status = 'rejected';
      submission.updatedAt = new Date();
      submission.reviewResult = {
        approved: false,
        approvalRate: data.consensus.approvalRate,
        totalReviews: data.consensus.totalReviews,
        averageRiskScore: data.consensus.averageRiskScore,
        concerns: data.reasons,
        consensusTime: new Date(data.consensus.consensusTime),
      };
      
      logger.info('Strategy rejected', { 
        submissionId: submission.submissionId,
        reasons: data.reasons,
      });
    }
  });

  /**
   * POST /api/v1/strategies/submit
   * Submit a new strategy for validation and review
   */
  fastify.post<{
    Body: z.infer<typeof StrategySubmissionSchema>;
  }>(
    '/api/v1/strategies/submit',
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        // Validate request
        const data = StrategySubmissionSchema.parse(request.body);
        
        // Generate IDs
        const submissionId = randomUUID();
        const strategyId = createHash('sha256')
          .update(`${data.submitterAddress}-${data.name}-${Date.now()}`)
          .digest('hex');
        
        // Create submission record
        const submission: StrategySubmission = {
          submissionId,
          strategyId,
          submitterAddress: data.submitterAddress.toLowerCase(),
          name: data.name,
          description: data.description,
          category: data.category,
          riskLevel: data.riskLevel,
          expectedApy: data.expectedApy,
          performanceFee: data.performanceFee,
          codeUrl: data.codeUrl,
          backtestResults: data.backtestResults,
          stakeAmount: data.stakeAmount,
          status: 'pending',
          submittedAt: new Date(),
          updatedAt: new Date(),
        };
        
        // Store submission
        submissions.set(submissionId, submission);
        
        // Track user submissions
        const userSubs = userSubmissions.get(data.submitterAddress.toLowerCase()) || [];
        userSubs.push(submissionId);
        userSubmissions.set(data.submitterAddress.toLowerCase(), userSubs);
        
        logger.info('Strategy submitted', {
          submissionId,
          strategyId,
          submitter: data.submitterAddress,
          name: data.name,
        });
        
        // Start async validation
        setImmediate(() => validateStrategy(submission));
        
        return reply.code(201).send({
          submissionId,
          strategyId,
          status: 'pending',
          message: 'Strategy submitted successfully. Validation in progress.',
        });
      } catch (error) {
        fastify.log.error(error);
        
        if (error instanceof z.ZodError) {
          return reply.code(400).send({
            error: 'Validation Error',
            message: 'Invalid submission data',
            details: error.errors,
          });
        }
        
        return reply.code(500).send({
          error: 'Internal Server Error',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  );

  /**
   * GET /api/v1/strategies/:submissionId
   * Get submission status and details
   */
  fastify.get<{
    Params: { submissionId: string };
  }>(
    '/api/v1/strategies/:submissionId',
    async (request: FastifyRequest<{ Params: { submissionId: string } }>, reply: FastifyReply) => {
      const { submissionId } = request.params;
      
      const submission = submissions.get(submissionId);
      
      if (!submission) {
        return reply.code(404).send({
          error: 'Not Found',
          message: 'Submission not found',
        });
      }
      
      return reply.code(200).send({
        submissionId: submission.submissionId,
        strategyId: submission.strategyId,
        name: submission.name,
        status: submission.status,
        submittedAt: submission.submittedAt.getTime(),
        updatedAt: submission.updatedAt.getTime(),
        validationResult: submission.validationResult,
        reviewResult: submission.reviewResult,
        onChainId: submission.onChainId,
      });
    }
  );

  /**
   * GET /api/v1/strategies/user/:address
   * Get all submissions for a user
   */
  fastify.get<{
    Params: { address: string };
  }>(
    '/api/v1/strategies/user/:address',
    async (request: FastifyRequest<{ Params: { address: string } }>, reply: FastifyReply) => {
      const { address } = request.params;
      
      const submissionIds = userSubmissions.get(address.toLowerCase()) || [];
      const userSubs = submissionIds
        .map(id => submissions.get(id))
        .filter((s): s is StrategySubmission => !!s)
        .map(s => ({
          submissionId: s.submissionId,
          name: s.name,
          status: s.status,
          submittedAt: s.submittedAt,
          updatedAt: s.updatedAt,
          validationResult: s.validationResult ? {
            passed: s.validationResult.passed,
            score: s.validationResult.score,
            feedback: s.validationResult.feedback,
          } : undefined,
        }));
      
      return reply.code(200).send({
        address: address.toLowerCase(),
        submissions: userSubs,
        total: userSubs.length,
      });
    }
  );

  /**
   * GET /api/v1/strategies/pending-reviews
   * Get strategies pending Guardian review (for Guardian nodes)
   */
  fastify.get(
    '/api/v1/strategies/pending-reviews',
    async (request: FastifyRequest, reply: FastifyReply) => {
      // TODO: Add authentication for Guardian nodes
      
      const pendingReviews = reviewService.getPendingReviews();
      
      return reply.code(200).send({
        reviews: pendingReviews,
        total: pendingReviews.length,
      });
    }
  );

  /**
   * POST /api/v1/strategies/:submissionId/review
   * Submit a Guardian review for a strategy
   */
  fastify.post<{
    Params: { submissionId: string };
    Body: {
      guardianAddress: string;
      approved: boolean;
      riskScore: number;
      concerns: string[];
      signature: string;
    };
  }>(
    '/api/v1/strategies/:submissionId/review',
    async (request: FastifyRequest<{
      Params: { submissionId: string };
      Body: {
        guardianAddress: string;
        approved: boolean;
        riskScore: number;
        concerns: string[];
        signature: string;
      };
    }>, reply: FastifyReply) => {
      const { submissionId } = request.params;
      const { guardianAddress, approved, riskScore, concerns } = request.body;
      
      const submission = submissions.get(submissionId);
      
      if (!submission) {
        return reply.code(404).send({
          error: 'Not Found',
          message: 'Submission not found',
        });
      }
      
      if (submission.status !== 'under_review') {
        return reply.code(400).send({
          error: 'Invalid State',
          message: 'Strategy is not under review',
        });
      }
      
      // TODO: Verify guardian signature and eligibility
      
      logger.info('Guardian review submitted', {
        submissionId,
        guardianAddress,
        approved,
        riskScore,
      });
      
      return reply.code(200).send({
        message: 'Review submitted successfully',
        submissionId,
      });
    }
  );

  /**
   * GET /api/v1/strategies/stats
   * Get strategy submission statistics
   */
  fastify.get(
    '/api/v1/strategies/stats',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const allSubmissions = Array.from(submissions.values());
      
      const stats = {
        total: allSubmissions.length,
        pending: allSubmissions.filter(s => s.status === 'pending').length,
        validating: allSubmissions.filter(s => s.status === 'validating').length,
        underReview: allSubmissions.filter(s => s.status === 'under_review').length,
        approved: allSubmissions.filter(s => s.status === 'approved').length,
        rejected: allSubmissions.filter(s => s.status === 'rejected').length,
        deployed: allSubmissions.filter(s => s.status === 'deployed').length,
        active: allSubmissions.filter(s => s.status === 'active').length,
      };
      
      return reply.code(200).send(stats);
    }
  );

  fastify.log.info('Strategy routes registered');
}

/**
 * Validate strategy submission
 */
async function validateStrategy(submission: StrategySubmission): Promise<void> {
  try {
    submission.status = 'validating';
    submission.updatedAt = new Date();
    
    logger.info('Starting strategy validation', { submissionId: submission.submissionId });
    
    // 1. Security analysis
    const securityChecks = await analyzeRepository(submission.codeUrl);
    
    // 2. Run backtest
    const backtestMetrics = await runBacktest(submission);
    
    // 3. Calculate validation score
    const score = calculateValidationScore(
      {
        noHardcodedKeys: !securityChecks.hasApiKeys,
        hasErrorHandling: securityChecks.hasErrorHandling,
        hasRiskManagement: securityChecks.hasRiskManagement,
      },
      backtestMetrics
    );
    
    // 4. Determine if passed (score >= 60)
    const passed = score >= 60;
    
    submission.validationResult = {
      passed,
      score,
      backtestMetrics,
      securityChecks: {
        noHardcodedKeys: !securityChecks.hasApiKeys,
        hasErrorHandling: securityChecks.hasErrorHandling,
        hasRiskManagement: securityChecks.hasRiskManagement,
      },
      feedback: passed ? undefined : generateFeedback(
        {
          noHardcodedKeys: !securityChecks.hasApiKeys,
          hasErrorHandling: securityChecks.hasErrorHandling,
          hasRiskManagement: securityChecks.hasRiskManagement,
        },
        backtestMetrics
      ),
    };
    
    if (passed) {
      // Submit for Guardian review
      submission.status = 'under_review';
      submission.updatedAt = new Date();
      
      await reviewService.submitForReview({
        strategyId: submission.strategyId,
        name: submission.name,
        description: submission.description,
        category: submission.category,
        riskLevel: submission.riskLevel,
        expectedApy: submission.expectedApy,
        codeUrl: submission.codeUrl,
        submitterAddress: submission.submitterAddress,
        backtestResults: backtestMetrics,
      });
      
      logger.info('Strategy passed validation, submitted for review', {
        submissionId: submission.submissionId,
        score,
      });
    } else {
      submission.status = 'rejected';
      submission.updatedAt = new Date();
      
      logger.info('Strategy failed validation', {
        submissionId: submission.submissionId,
        score,
        feedback: submission.validationResult.feedback,
      });
    }
  } catch (error) {
    logger.error('Validation error', {
      submissionId: submission.submissionId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    
    submission.status = 'rejected';
    submission.updatedAt = new Date();
    submission.validationResult = {
      passed: false,
      score: 0,
      feedback: 'Validation failed due to an internal error. Please try again.',
    };
  }
}

/**
 * Analyze repository for security and quality
 */
async function analyzeRepository(codeUrl: string): Promise<{
  hasApiKeys: boolean;
  hasErrorHandling: boolean;
  hasRiskManagement: boolean;
}> {
  // For testnet, return mock analysis
  // In production, this would:
  // 1. Clone the repository
  // 2. Scan for hardcoded API keys
  // 3. Analyze code structure
  // 4. Check for error handling patterns
  // 5. Check for risk management (stop loss, position sizing)
  
  return {
    hasApiKeys: false, // No hardcoded keys found
    hasErrorHandling: true,
    hasRiskManagement: true,
  };
}

/**
 * Run backtest on strategy
 */
async function runBacktest(submission: StrategySubmission): Promise<{
  sharpeRatio: number;
  maxDrawdown: number;
  winRate: number;
  totalTrades: number;
  annualizedReturn: number;
}> {
  // For testnet, return mock backtest results based on expected APY
  // In production, this would:
  // 1. Load strategy code
  // 2. Run against historical data
  // 3. Calculate actual metrics
  
  const expectedApy = submission.expectedApy;
  const riskMultiplier = submission.riskLevel === 'high' ? 1.5 : submission.riskLevel === 'medium' ? 1.0 : 0.7;
  
  // Simulate realistic metrics based on expected APY
  return {
    sharpeRatio: Math.min(3, (expectedApy / 100) * 2 + 0.5 + (Math.random() - 0.5) * 0.5),
    maxDrawdown: Math.min(0.5, 0.05 + (expectedApy / 100) * 0.3 * riskMultiplier),
    winRate: 0.45 + Math.random() * 0.2,
    totalTrades: Math.floor(100 + Math.random() * 400),
    annualizedReturn: expectedApy / 100 + (Math.random() - 0.5) * 0.1,
  };
}

/**
 * Calculate validation score
 */
function calculateValidationScore(
  securityChecks: { noHardcodedKeys: boolean; hasErrorHandling: boolean; hasRiskManagement: boolean },
  backtestMetrics: { sharpeRatio: number; maxDrawdown: number; winRate: number }
): number {
  let score = 0;
  
  // Security (30 points)
  if (securityChecks.noHardcodedKeys) score += 15;
  if (securityChecks.hasErrorHandling) score += 10;
  if (securityChecks.hasRiskManagement) score += 5;
  
  // Backtest performance (70 points)
  // Sharpe ratio (30 points)
  score += Math.min(30, backtestMetrics.sharpeRatio * 15);
  
  // Max drawdown (20 points) - lower is better
  score += Math.max(0, 20 - backtestMetrics.maxDrawdown * 40);
  
  // Win rate (20 points)
  score += Math.min(20, backtestMetrics.winRate * 40);
  
  return Math.round(score);
}

/**
 * Generate feedback for failed validation
 */
function generateFeedback(
  securityChecks: { noHardcodedKeys: boolean; hasErrorHandling: boolean; hasRiskManagement: boolean },
  backtestMetrics: { sharpeRatio: number; maxDrawdown: number; winRate: number }
): string {
  const issues: string[] = [];
  
  if (!securityChecks.noHardcodedKeys) {
    issues.push('Hardcoded API keys detected. Please remove all sensitive credentials.');
  }
  if (!securityChecks.hasErrorHandling) {
    issues.push('Insufficient error handling. Please add try-catch blocks and error recovery.');
  }
  if (!securityChecks.hasRiskManagement) {
    issues.push('Missing risk management. Please add stop-loss and position sizing logic.');
  }
  if (backtestMetrics.sharpeRatio < 0.5) {
    issues.push(`Sharpe ratio (${backtestMetrics.sharpeRatio.toFixed(2)}) is below minimum threshold of 0.5.`);
  }
  if (backtestMetrics.maxDrawdown > 0.4) {
    issues.push(`Max drawdown (${(backtestMetrics.maxDrawdown * 100).toFixed(1)}%) exceeds 40% limit.`);
  }
  
  return issues.length > 0 
    ? `Validation failed: ${issues.join(' ')}` 
    : 'Validation failed due to low overall score.';
}
