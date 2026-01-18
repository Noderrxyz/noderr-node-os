/**
 * @noderr/compliance
 * 
 * Institutional-grade compliance and regulatory framework for algorithmic trading.
 * 
 * This module provides comprehensive compliance checks and regulatory reporting
 * capabilities to ensure trading operations meet all applicable regulations including
 * FINRA, SEC, and other regulatory requirements.
 * 
 * @module @noderr/compliance
 */

export * from './ComplianceEngine';
export * from './TradeReporting';


// ============================================================================
// Main Entry Point
// ============================================================================

import { Logger } from '@noderr/utils';
import { getShutdownHandler, onShutdown } from '@noderr/utils';

let complianceService: any | null = null;

export async function startComplianceService(): Promise<void> {
  const logger = new Logger('ComplianceService');
  
  try {
    logger.info('Starting Compliance Service...');
    
    // TODO: Initialize ComplianceEngine when implementation is complete
    // complianceService = new ComplianceEngine({...});
    
    onShutdown('compliance-service', async () => {
      logger.info('Shutting down compliance service...');
      
      // TODO: Implement cleanup
      // - Flush pending reports
      // - Save compliance state
      
      logger.info('Compliance service shut down complete');
    }, 10000);
    
    logger.info('Compliance Service started successfully');
    await new Promise(() => {});
  } catch (error) {
    logger.error('Failed to start Compliance Service', error);
    throw error;
  }
}

if (require.main === module) {
  getShutdownHandler(30000);
  startComplianceService().catch((error) => {
    logger.error('Fatal error starting Compliance Service:', error);
    process.exit(1);
  });
}
