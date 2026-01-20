import express, { Request, Response, NextFunction } from 'express';
import bodyParser from 'body-parser';
import rateLimit from 'express-rate-limit';
import cors from 'cors';
import { z, ZodIssue } from 'zod';
import { validateStrategy } from './StrategyValidator';
import { runInitialBacktest } from './StrategyBacktester';
import { registerStrategyOnChain } from './OnChainRegistry';
import simpleGit from 'simple-git';
import { Logger } from '@noderr/utils/src';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs/promises';
import * as path from 'path';

const git = simpleGit();
const logger = new Logger('StrategyIngestionApi');
const CLONE_DIR = path.join(process.cwd(), 'cloned_strategies');

// LOW FIX #13: Use Number type for PORT
const PORT = Number(process.env.PORT) || 3001;

const StrategySubmissionSchema = z.object({
    repoUrl: z.string().url({ message: "Invalid Git repository URL" }),
    commitHash: z.string().regex(/^[a-fA-F0-9]{7,40}$/, { message: "Commit hash must be a valid git hash (7-40 hex characters)" }).optional(),
    strategyName: z.string().regex(/^[a-zA-Z0-9_-]{3,50}$/, { message: "Strategy name must be 3-50 characters and contain only alphanumeric, underscore, or hyphen" }),
    authorAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/, { message: "Invalid Ethereum address format" }),
});

type StrategySubmission = z.infer<typeof StrategySubmissionSchema>;

const submitStrategy = async (req: Request, res: Response) => {
    const submissionId = uuidv4();
    let strategyLocalPath: string = '';

    try {
        const submission: StrategySubmission = StrategySubmissionSchema.parse(req.body);
        
        // SECURITY FIX: Sanitize strategy name to prevent path traversal
        const sanitizedStrategyName = path.basename(submission.strategyName);
        if (sanitizedStrategyName !== submission.strategyName) {
            throw new Error('Strategy name contains invalid path components');
        }
        
        // Use submission ID to ensure unique directory per submission
        strategyLocalPath = path.join(CLONE_DIR, submissionId, sanitizedStrategyName);
        logger.info(`[${submissionId}] Received strategy submission: ${submission.strategyName}`);

        // --- Git Clone ---
        try {
            logger.info(`[${submissionId}] Cloning ${submission.repoUrl}`);
            
            // SECURITY FIX: Clone first, then checkout specific commit to avoid command injection
            await git.clone(submission.repoUrl, strategyLocalPath);
            
            if (submission.commitHash) {
                // Validate commit hash format again before checkout
                if (!/^[a-fA-F0-9]{7,40}$/.test(submission.commitHash)) {
                    throw new Error('Invalid commit hash format');
                }
                await git.cwd(strategyLocalPath).checkout(submission.commitHash);
                logger.info(`[${submissionId}] Checked out commit ${submission.commitHash}`);
            }
            
            logger.info(`[${submissionId}] Successfully cloned repository.`);
        } catch (gitError) {
            logger.error(`[${submissionId}] Git cloning failed.`, { error: gitError });
            return res.status(422).json({
                status: 'Git Error',
                message: 'Failed to clone the strategy repository. Check URL or commit hash.',
                details: gitError instanceof Error ? gitError.message : 'Unknown git error',
            });
        }

        // --- Validation ---
        try {
            await validateStrategy(strategyLocalPath);
            logger.info(`[${submissionId}] Strategy code validation passed.`);
        } catch (validationError) {
            logger.error(`[${submissionId}] Strategy validation failed.`, { error: validationError });
            await fs.rm(strategyLocalPath, { recursive: true, force: true });
            logger.warn(`[${submissionId}] Cleaned up failed clone directory.`);
            return res.status(400).json({
                status: 'Validation Failed',
                message: validationError instanceof Error ? validationError.message : 'Strategy code failed institutional-grade validation.',
            });
        }

        // --- Backtest ---
        let backtestResults;
        try {
            backtestResults = await runInitialBacktest(strategyLocalPath);
            logger.info(`[${submissionId}] Backtest passed.`, { sharpe: backtestResults.sharpeRatio });
        } catch (backtestError) {
            logger.error(`[${submissionId}] Initial backtest failed.`, { error: backtestError });
            await fs.rm(strategyLocalPath, { recursive: true, force: true });
            logger.warn(`[${submissionId}] Cleaned up failed clone directory.`);
            return res.status(400).json({
                status: 'Backtest Failed',
                message: backtestError instanceof Error ? backtestError.message : 'Initial backtest failed to meet minimum performance criteria.',
            });
        }

        // --- On-Chain Registration ---
        let txHash;
        try {
            txHash = await registerStrategyOnChain(
                submission.strategyName,
                submission.authorAddress,
                backtestResults
            );
            logger.info(`[${submissionId}] Strategy registered on-chain.`, { txHash });
        } catch (chainError) {
            logger.error(`[${submissionId}] On-chain registration failed.`, { error: chainError });
            return res.status(503).json({
                status: 'On-Chain Error',
                message: 'Strategy passed local checks but failed on-chain registration. Check network status.',
                details: chainError instanceof Error ? chainError.message : 'Unknown on-chain error',
            });
        }

        // --- Final Cleanup and Response ---
        await fs.rm(strategyLocalPath, { recursive: true, force: true });
        logger.info(`[${submissionId}] Successfully processed and cleaned up strategy: ${submission.strategyName}`);

        return res.status(202).json({
            status: 'Accepted',
            message: `Strategy '${submission.strategyName}' passed all institutional checks and has been submitted for on-chain registration.`,
            submissionId,
            details: {
                ...submission,
                backtest: backtestResults,
                transactionHash: txHash,
            }
        });

    } catch (error) {
        if (strategyLocalPath) {
            await fs.rm(strategyLocalPath, { recursive: true, force: true }).catch(() => {});
        }
        if (error instanceof z.ZodError) {
            return res.status(400).json({
                status: 'Validation Error',
                message: 'Invalid strategy submission data.',
                errors: error.issues.map((e: ZodIssue) => ({ path: e.path.join('.'), message: e.message })),
            });
        }
        logger.error(`[${submissionId}] Internal server error.`, { error });
        return res.status(500).json({
            status: 'Error',
            message: 'An internal error occurred during processing.',
        });
    }
};

const app = express();

// SECURITY FIX: Add rate limiting to prevent DoS attacks
const submissionLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10, // Limit each IP to 10 requests per windowMs
    message: 'Too many strategy submissions from this IP, please try again later.',
    standardHeaders: true,
    legacyHeaders: false,
});

// MEDIUM FIX #11: Add CORS configuration for browser-based clients
app.use(cors({
    origin: process.env.ALLOWED_ORIGINS?.split(',') || '*', // Configure via env var or allow all for testnet
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(bodyParser.json());
app.post('/submit-strategy', submissionLimiter as any, submitStrategy);

// QUICK WIN: Enhanced health check endpoint
app.get('/health', async (req: Request, res: Response) => {
    try {
        // Check if clone directory is accessible
        await fs.access(CLONE_DIR);
        
        // Check if we can write to the directory
        const testFile = path.join(CLONE_DIR, '.health-check');
        await fs.writeFile(testFile, 'ok');
        await fs.unlink(testFile);
        
        res.status(200).json({ 
            status: 'healthy', 
            service: 'Strategy Ingestion API',
            timestamp: new Date().toISOString(),
            checks: {
                filesystem: 'ok',
                cloneDirectory: 'ok'
            }
        });
    } catch (error) {
        logger.error('Health check failed', { error });
        res.status(503).json({ 
            status: 'unhealthy', 
            service: 'Strategy Ingestion API',
            timestamp: new Date().toISOString(),
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
    logger.error('Global error handler caught an error:', { error: err });
    res.status(500).send('Something broke!');
});

export const startStrategyIngestionApi = async () => {
    // MEDIUM FIX #10: Make startup cleanup a hard requirement - fail fast if it cannot be completed
    try {
        await fs.rm(CLONE_DIR, { recursive: true, force: true });
        await fs.mkdir(CLONE_DIR, { recursive: true });
        logger.info('Cleaned up and recreated strategy clone directory on startup.');
    } catch (error) {
        logger.error('FATAL: Could not cleanup clone directory on startup. Cannot start server.', { error });
        throw new Error('Failed to initialize strategy clone directory');
    }

    app.listen(PORT, () => {
        logger.info(`Strategy Ingestion API running on port ${PORT}`);
    });
};
