/**
 * Strategy Submission API Routes
 * 
 * Handles strategy submissions from the dApp, integrates with:
 * - Guardian consensus for review
 * - Backtesting framework for validation
 * - On-chain strategy registry
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { StrategyReviewService, StrategyReviewRequest } from '@noderr/guardian-consensus';
import { BacktestingFramework, BacktestConfig, Strategy, MarketData, Portfolio, Signal } from '@noderr/backtesting';
import { randomUUID } from 'crypto';
import { createHash } from 'crypto';
import * as winston from 'winston';

// In-memory storage for testnet (use database in production)
const submissions = new Map<string, StrategySubmission>();
const userSubmissions = new Map<string, string[]>(); // address -> submissionIds

// Strategy Review Service instance
const reviewService = new StrategyReviewService({
  minReviewers: 3, // Reduced for testnet
  approvalThreshold: 0.6, // 60% approval required
  reviewTimeout: 24 * 60 * 60 * 1000, // 24 hours for testnet
});

// Logger
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console(),
  ],
});

// Backtesting framework
const backtestFramework = new BacktestingFramework(logger);

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
        .filter((s): s is StrategySubmission
 => !!s)
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
   * POST /api/v1/strategies/:strategyId/review
   * Submit a Guardian review (for Guardian nodes)
   */
  fastify.post<{
    Params: { strategyId: string };
    Body: {
      guardianId: string;
      approved: boolean;
      riskScore: number;
      concerns: string[];
    };
  }>(
    '/api/v1/strategies/:strategyId/review',
    async (request: FastifyRequest<{
      Params: { strategyId: string };
      Body: {
        guardianId: string;
        approved: boolean;
        riskScore: number;
        concerns: string[];
      };
    }>, reply: FastifyReply) => {
      // TODO: Add authentication for Guardian nodes
      
      const { strategyId } = request.params;
      const { guardianId, approved, riskScore, concerns } = request.body;
      
      try {
        await reviewService.submitReview({
          guardianId,
          strategyId,
          approved,
          riskScore,
          concerns,
          timestamp: Date.now(),
        });
        
        return reply.code(200).send({
          message: 'Review submitted successfully',
          strategyId,
          guardianId,
        });
      } catch (error) {
        return reply.code(400).send({
          error: 'Review Error',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  );

  /**
   * GET /health
   * Health check endpoint
   */
  fastify.get('/health', async (request: FastifyRequest, reply: FastifyReply) => {
    return reply.code(200).send({
      status: 'healthy',
      service: 'oracle-api',
      timestamp: new Date().toISOString(),
      stats: {
        totalSubmissions: submissions.size,
        pendingReviews: reviewService.getPendingReviews().length,
      },
    });
  });
}

/**
 * Validate a strategy submission
 * 
 * 1. Fetch and analyze code from repository
 * 2. Run security checks
 * 3. Run backtests
 * 4. Submit for Guardian review if passed
 */
async function validateStrategy(submission: StrategySubmission): Promise<void> {
  logger.info('Starting validation', { submissionId: submission.submissionId });
  
  submission.status = 'validating';
  submission.updatedAt = new Date();
  
  try {
    // Step 1: Fetch code from repository
    const codeAnalysis = await analyzeRepository(submission.codeUrl);
    
    // Step 2: Security checks
    const securityChecks = {
      noHardcodedKeys: !codeAnalysis.hasApiKeys,
      hasErrorHandling: codeAnalysis.hasErrorHandling,
      hasRiskManagement: codeAnalysis.hasRiskManagement,
    };
    
    const securityPassed = Object.values(securityChecks).every(v => v);
    
    // Step 3: Run backtest (simplified for testnet)
    const backtestMetrics = await runBacktest(submission);
    
    // Calculate validation score
    const score = calculateValidationScore(securityChecks, backtestMetrics);
    const passed = score >= 60 && securityPassed && backtestMetrics.sharpeRatio >= 0.5;
    
    // Update validation result
    submission.validationResult = {
      passed,
      score,
      backtestMetrics,
      securityChecks,
      feedback: passed 
        ? 'Strategy passed validation. Submitted for Guardian review.'
        : generateFeedback(securityChecks, backtestMetrics),
    };
    
    if (passed) {
      // Submit for Guardian review
      submission.status = 'under_review';
      submission.updatedAt = new Date();
      
      const reviewRequest: StrategyReviewRequest = {
        strategyId: submission.strategyId,
        submissionId: submission.submissionId,
        submitterAddress: submission.submitterAddress,
        name: submission.name,
        description: submission.description,
        codeUrl: submission.codeUrl,
        backtestMetrics,
        riskProfile: {
          maxPositionSize: 0.1, // 10% max position
          maxLeverage: submission.riskLevel === 'high' ? 3 : submission.riskLevel === 'medium' ? 2 : 1,
          stopLossRequired: true,
        },
      };
      
      await reviewService.submitForReview(reviewRequest);
      
      logger.info('Strategy submitted for review', { 
        submissionId: submission.submissionId,
        score,
      });
    } else {
      submission.status = 'rejected';
      submission.updatedAt = new Date();
      
      logger.info('Strategy validation failed', { 
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
    submission.validationResult = {
      passed: false,
      score: 0,
      feedback: `Validation error: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
    submission.updatedAt = new Date();
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
