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
    timeout?: number;
}
export declare class GracefulShutdown {
    private handlers;
    private isShuttingDown;
    private shutdownTimeout;
    private logger;
    constructor(timeout?: number, logger?: Logger);
    /**
     * Register a cleanup handler
     */
    registerHandler(handler: ShutdownHandler): void;
    /**
     * Setup signal handlers for graceful shutdown
     */
    private setupSignalHandlers;
    /**
     * Setup error handlers
     */
    private setupErrorHandlers;
    /**
     * Execute shutdown sequence
     */
    private shutdown;
}
export declare function getShutdownHandler(timeout?: number): GracefulShutdown;
/**
 * Helper function to register a cleanup handler
 */
export declare function onShutdown(name: string, cleanup: () => Promise<void>, timeout?: number): void;
/**
 * Helper function to create a cleanup handler for a connection
 */
export declare function registerConnection(name: string, connection: any, closeMethod?: string): void;
/**
 * Helper function to create a cleanup handler for multiple connections
 */
export declare function registerConnections(connections: Array<{
    name: string;
    connection: any;
    closeMethod?: string;
}>): void;
//# sourceMappingURL=graceful-shutdown.d.ts.map