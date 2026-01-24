"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.GracefulShutdown = void 0;
exports.getShutdownHandler = getShutdownHandler;
exports.onShutdown = onShutdown;
exports.registerConnection = registerConnection;
exports.registerConnections = registerConnections;
const index_1 = require("./index");
class GracefulShutdown {
    handlers = [];
    isShuttingDown = false;
    shutdownTimeout = 30000; // 30 seconds default
    // MEDIUM FIX #106: Use Logger instead of console
    logger;
    constructor(timeout, logger) {
        this.logger = logger || new index_1.Logger('GracefulShutdown');
        if (timeout) {
            this.shutdownTimeout = timeout;
        }
        this.setupSignalHandlers();
        this.setupErrorHandlers();
    }
    /**
     * Register a cleanup handler
     */
    registerHandler(handler) {
        this.handlers.push(handler);
    }
    /**
     * Setup signal handlers for graceful shutdown
     */
    setupSignalHandlers() {
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
    setupErrorHandlers() {
        // Handle uncaught exceptions
        process.on('uncaughtException', (error) => {
            this.logger.error('Uncaught exception:', error);
            this.shutdown('uncaughtException', 1);
        });
        // Handle unhandled promise rejections
        process.on('unhandledRejection', (reason, promise) => {
            this.logger.error('Unhandled rejection', { promise, reason });
            this.shutdown('unhandledRejection', 1);
        });
    }
    /**
     * Execute shutdown sequence
     */
    async shutdown(signal, exitCode = 0) {
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
                const handlerTimeout = handler.timeout || 10000; // 10 seconds default per handler
                try {
                    this.logger.info(`Cleaning up: ${handler.name}...`);
                    // Create a timeout promise
                    const timeoutPromise = new Promise((_, reject) => {
                        setTimeout(() => reject(new Error(`Timeout: ${handler.name}`)), handlerTimeout);
                    });
                    // Race between cleanup and timeout
                    await Promise.race([
                        handler.cleanup(),
                        timeoutPromise
                    ]);
                    this.logger.info(`✓ ${handler.name} cleaned up successfully`);
                }
                catch (error) {
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
        }
        catch (error) {
            this.logger.error('Error during shutdown:', error);
            clearTimeout(forceExitTimer);
            process.exit(1);
        }
    }
}
exports.GracefulShutdown = GracefulShutdown;
/**
 * Create a singleton instance for easy use across the application
 */
let shutdownInstance = null;
function getShutdownHandler(timeout) {
    if (!shutdownInstance) {
        shutdownInstance = new GracefulShutdown(timeout);
    }
    return shutdownInstance;
}
/**
 * Helper function to register a cleanup handler
 */
function onShutdown(name, cleanup, timeout) {
    const handler = getShutdownHandler();
    handler.registerHandler({ name, cleanup, timeout });
}
/**
 * Helper function to create a cleanup handler for a connection
 */
function registerConnection(name, connection, closeMethod = 'close') {
    onShutdown(name, async () => {
        if (connection && typeof connection[closeMethod] === 'function') {
            await connection[closeMethod]();
        }
    });
}
/**
 * Helper function to create a cleanup handler for multiple connections
 */
function registerConnections(connections) {
    connections.forEach(({ name, connection, closeMethod }) => {
        registerConnection(name, connection, closeMethod || 'close');
    });
}
//# sourceMappingURL=graceful-shutdown.js.map