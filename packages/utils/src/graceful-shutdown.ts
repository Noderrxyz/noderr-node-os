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
 * 
 * Quality: PhD-Level + Production-Grade
 */

export interface ShutdownHandler {
  name: string;
  cleanup: () => Promise<void>;
  timeout?: number;  // Optional timeout in milliseconds
}

export class GracefulShutdown {
  private handlers: ShutdownHandler[] = [];
  private isShuttingDown: boolean = false;
  private shutdownTimeout: number = 30000;  // 30 seconds default
  
  constructor(timeout?: number) {
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
      console.log('Received SIGTERM signal');
      this.shutdown('SIGTERM');
    });
    
    // Handle SIGINT (Ctrl+C)
    process.on('SIGINT', () => {
      console.log('Received SIGINT signal');
      this.shutdown('SIGINT');
    });
    
    // Handle SIGQUIT (Ctrl+\)
    process.on('SIGQUIT', () => {
      console.log('Received SIGQUIT signal');
      this.shutdown('SIGQUIT');
    });
  }
  
  /**
   * Setup error handlers
   */
  private setupErrorHandlers(): void {
    // Handle uncaught exceptions
    process.on('uncaughtException', (error: Error) => {
      console.error('Uncaught exception:', error);
      this.shutdown('uncaughtException', 1);
    });
    
    // Handle unhandled promise rejections
    process.on('unhandledRejection', (reason: any, promise: Promise<any>) => {
      console.error('Unhandled rejection at:', promise, 'reason:', reason);
      this.shutdown('unhandledRejection', 1);
    });
  }
  
  /**
   * Execute shutdown sequence
   */
  private async shutdown(signal: string, exitCode: number = 0): Promise<void> {
    // Prevent multiple shutdown attempts
    if (this.isShuttingDown) {
      console.log('Shutdown already in progress, ignoring signal');
      return;
    }
    
    this.isShuttingDown = true;
    
    console.log(`========================================`);
    console.log(`Initiating graceful shutdown (${signal})`);
    console.log(`========================================`);
    
    // Set a hard timeout to force exit if cleanup takes too long
    const forceExitTimer = setTimeout(() => {
      console.error(`Shutdown timeout exceeded (${this.shutdownTimeout}ms), forcing exit`);
      process.exit(1);
    }, this.shutdownTimeout);
    
    try {
      // Execute all cleanup handlers in parallel
      const cleanupPromises = this.handlers.map(async (handler) => {
        const handlerTimeout = handler.timeout || 10000;  // 10 seconds default per handler
        
        try {
          console.log(`Cleaning up: ${handler.name}...`);
          
          // Create a timeout promise
          const timeoutPromise = new Promise<void>((_, reject) => {
            setTimeout(() => reject(new Error(`Timeout: ${handler.name}`)), handlerTimeout);
          });
          
          // Race between cleanup and timeout
          await Promise.race([
            handler.cleanup(),
            timeoutPromise
          ]);
          
          console.log(`✓ ${handler.name} cleaned up successfully`);
        } catch (error) {
          console.error(`✗ ${handler.name} cleanup failed:`, error);
          // Continue with other handlers even if one fails
        }
      });
      
      // Wait for all cleanup handlers to complete
      await Promise.all(cleanupPromises);
      
      console.log(`========================================`);
      console.log(`Graceful shutdown complete`);
      console.log(`========================================`);
      
      // Clear the force exit timer
      clearTimeout(forceExitTimer);
      
      // Exit with appropriate code
      process.exit(exitCode);
    } catch (error) {
      console.error('Error during shutdown:', error);
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
