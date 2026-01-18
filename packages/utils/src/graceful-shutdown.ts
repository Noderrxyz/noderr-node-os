/**
 * Graceful Shutdown Utility
 * 
 * Provides a standardized way to handle process termination signals
 * and ensure clean shutdown of services.
 * 
 * Features:
 * - Signal handling (SIGTERM, SIGINT, SIGQUIT)
 * - Cleanup callback registration
 * - Timeout enforcement
 * - Uncaught exception handling
 * - Unhandled rejection handling
 * - Graceful connection closing
 */

import { Logger } from './index';

export interface ShutdownHandler {
  name: string;
  cleanup: () => Promise<void>;
  timeout?: number;  // Optional timeout in milliseconds
}

export class GracefulShutdown {
  private handlers: ShutdownHandler[] = [];
  private isShuttingDown: boolean = false;
  private shutdownTimeout: number = 30000;  // 30 seconds default
  // MEDIUM FIX #106: Use Logger instead of console
  private logger: Logger;
  
  constructor(timeout?: number, logger?: Logger) {
    this.logger = logger || new Logger('GracefulShutdown');
    if (timeout) {
      this.shutdownTimeout = timeout;
    }
    
    this.setupSignalHandlers();
    this.setupErrorHandlers();
  }
  
  /**
   * Register a cleanup handler
   */
  public registerHandler(handler: ShutdownHandler): void {
    this.handlers.push(handler);
  }
  
  /**
   * Setup signal handlers for graceful shutdown
   */
  private setupSignalHandlers(): void {
    // Handle SIGTERM (Docker stop, Kubernetes termination)
    process.on('SIGTERM', () => {
      this.logger.info('Received SIGTERM signal');
      this.shutdown('SIGTERM');
    });
    
    // Handle SIGINT (Ctrl+C)
    process.on('SIGINT', () => {
      this.logger.info('Received SIGINT signal');
      this.shutdown('SIGINT');
    });
    
    // Handle SIGQUIT (Ctrl+\)
    process.on('SIGQUIT', () => {
      this.logger.info('Received SIGQUIT signal');
      this.shutdown('SIGQUIT');
    });
  }
  
  /**
   * Setup error handlers
   */
  private setupErrorHandlers(): void {
    // Handle uncaught exceptions
    process.on('uncaughtException', (error: Error) => {
      this.logger.error('Uncaught exception:', error);
      this.shutdown('uncaughtException', 1);
    });
    
    // Handle unhandled promise rejections
    process.on('unhandledRejection', (reason: any, promise: Promise<any>) => {
      this.logger.error('Unhandled rejection', { promise, reason });
      this.shutdown('unhandledRejection', 1);
    });
  }
  
  /**
   * Execute shutdown sequence
   */
  private async shutdown(signal: string, exitCode: number = 0): Promise<void> {
    // Prevent multiple shutdown attempts
    if (this.isShuttingDown) {
      this.logger.info('Shutdown already in progress, ignoring signal');
      return;
    }
    
    this.isShuttingDown = true;
    
    this.logger.info(`========================================`);
    this.logger.info(`Initiating graceful shutdown (${signal})`);
    this.logger.info(`========================================`);
    
    // Set a hard timeout to force exit if cleanup takes too long
    const forceExitTimer = setTimeout(() => {
      this.logger.error(`Shutdown timeout exceeded (${this.shutdownTimeout}ms), forcing exit`);
      process.exit(1);
    }, this.shutdownTimeout);
    
    try {
      // Execute all cleanup handlers in parallel
      const cleanupPromises = this.handlers.map(async (handler) => {
        const handlerTimeout = handler.timeout || 10000;  // 10 seconds default per handler
        
        try {
          this.logger.info(`Cleaning up: ${handler.name}...`);
          
          // Create a timeout promise
          const timeoutPromise = new Promise<void>((_, reject) => {
            setTimeout(() => reject(new Error(`Timeout: ${handler.name}`)), handlerTimeout);
          });
          
          // Race between cleanup and timeout
          await Promise.race([
            handler.cleanup(),
            timeoutPromise
          ]);
          
          this.logger.info(`✓ ${handler.name} cleaned up successfully`);
        } catch (error) {
          this.logger.error(`✗ ${handler.name} cleanup failed:`, error);
          // Continue with other handlers even if one fails
        }
      });
      
      // Wait for all cleanup handlers to complete
      await Promise.all(cleanupPromises);
      
      this.logger.info(`========================================`);
      this.logger.info(`Graceful shutdown complete`);
      this.logger.info(`========================================`);
      
      // Clear the force exit timer
      clearTimeout(forceExitTimer);
      
      // Exit with appropriate code
      process.exit(exitCode);
    } catch (error) {
      this.logger.error('Error during shutdown:', error);
      clearTimeout(forceExitTimer);
      process.exit(1);
    }
  }
}

/**
 * Create a singleton instance for easy use across the application
 */
let shutdownInstance: GracefulShutdown | null = null;

export function getShutdownHandler(timeout?: number): GracefulShutdown {
  if (!shutdownInstance) {
    shutdownInstance = new GracefulShutdown(timeout);
  }
  return shutdownInstance;
}

/**
 * Helper function to register a cleanup handler
 */
export function onShutdown(name: string, cleanup: () => Promise<void>, timeout?: number): void {
  const handler = getShutdownHandler();
  handler.registerHandler({ name, cleanup, timeout });
}

/**
 * Helper function to create a cleanup handler for a connection
 */
export function registerConnection(name: string, connection: any, closeMethod: string = 'close'): void {
  onShutdown(name, async () => {
    if (connection && typeof connection[closeMethod] === 'function') {
      await connection[closeMethod]();
    }
  });
}

/**
 * Helper function to create a cleanup handler for multiple connections
 */
export function registerConnections(connections: Array<{ name: string; connection: any; closeMethod?: string }>): void {
  connections.forEach(({ name, connection, closeMethod }) => {
    registerConnection(name, connection, closeMethod || 'close');
  });
}
