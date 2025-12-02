// Adaptive Capital Allocation AI Module
// Phase 6 of Noderr Protocol Elite Expansion

export { DynamicWeightAllocator } from './DynamicWeightAllocator';
export { CapitalFlowOptimizer } from './CapitalFlowOptimizer';
export { PortfolioSentinel } from './PortfolioSentinel';
export { CapitalStrategyDashboard } from './CapitalStrategyDashboard';

// Version
export const CAPITAL_AI_VERSION = '1.0.0'; 

// ============================================================================
// Main Entry Point
// ============================================================================

import { Logger } from '@noderr/utils';
import { getShutdownHandler, onShutdown } from '@noderr/utils';

let capitalAIService: any | null = null;

export async function startCapitalAIService(): Promise<void> {
  const logger = new Logger('CapitalAIService');
  
  try {
    logger.info('Starting Capital AI Service...');
    
    // TODO: Initialize Capital AI components when implementation is complete
    // - DynamicWeightAllocator
    // - CapitalFlowOptimizer
    // - PortfolioSentinel
    
    onShutdown('capital-ai-service', async () => {
      logger.info('Shutting down capital AI service...');
      
      // TODO: Implement cleanup
      // - Save portfolio state
      // - Close connections
      
      logger.info('Capital AI service shut down complete');
    }, 10000);
    
    logger.info('Capital AI Service started successfully');
    await new Promise(() => {});
  } catch (error) {
    logger.error('Failed to start Capital AI Service', error);
    throw error;
  }
}

if (require.main === module) {
  getShutdownHandler(30000);
  startCapitalAIService().catch((error) => {
    console.error('Fatal error starting Capital AI Service:', error);
    process.exit(1);
  });
}
