import { Logger, onShutdown } from '@noderr/utils';
import { ReputationSystem, ReputationConfig } from '@noderr/decentralized-core/src/ReputationSystem';
import * as winston from 'winston';

let reputationSystem: ReputationSystem | null = null;

const defaultConfig: ReputationConfig = {
    initialScore: 50,
    maxScore: 100,
    minScore: 0,
    decayRate: 1,
    minActivityThreshold: 10,
    performanceWindow: 30
};

export async function startReputationService(config: ReputationConfig = defaultConfig): Promise<void> {
    const logger = new Logger('ReputationService');
    logger.info('Starting Reputation Service...');
    
    try {
        const winstonLogger = winston.createLogger({
            level: 'info',
            format: winston.format.json(),
            transports: [
                new winston.transports.Console()
            ]
        });
        
        reputationSystem = new ReputationSystem(config, winstonLogger);
        reputationSystem.start();
        
        // LOW FIX #81: Add shutdown hook for proper cleanup
        onShutdown('reputation-service', async () => {
            logger.info('Shutting down Reputation Service...');
            if (reputationSystem) {
                reputationSystem.stop();
            }
            logger.info('Reputation Service shut down complete.');
        });
        
        logger.info('Reputation Service started successfully.');
    } catch (error) {
        logger.error('Failed to start Reputation Service', { error });
        throw error;
    }
}

if (require.main === module) {
    startReputationService().catch(error => {
        const logger = new Logger('ReputationService');
        logger.error('Fatal error starting Reputation Service:', { error });
        process.exit(1);
    });
}

// Re-export types and classes from decentralized-core
export { ReputationSystem, ReputationConfig, ReputationTier, NodePerformance, ReputationUpdate } from '@noderr/decentralized-core/src/ReputationSystem';
