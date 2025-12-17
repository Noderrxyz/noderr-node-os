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
 *
 * Quality: PhD-Level + Production-Grade
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.GracefulShutdown = void 0;
exports.getShutdownHandler = getShutdownHandler;
exports.onShutdown = onShutdown;
exports.registerConnection = registerConnection;
exports.registerConnections = registerConnections;
class GracefulShutdown {
    constructor(timeout) {
        this.handlers = [];
        this.isShuttingDown = false;
        this.shutdownTimeout = 30000; // 30 seconds default
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
    setupErrorHandlers() {
        // Handle uncaught exceptions
        process.on('uncaughtException', (error) => {
            console.error('Uncaught exception:', error);
            this.shutdown('uncaughtException', 1);
        });
        // Handle unhandled promise rejections
        process.on('unhandledRejection', (reason, promise) => {
            console.error('Unhandled rejection at:', promise, 'reason:', reason);
            this.shutdown('unhandledRejection', 1);
        });
    }
    /**
     * Execute shutdown sequence
     */
    async shutdown(signal, exitCode = 0) {
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
                const handlerTimeout = handler.timeout || 10000; // 10 seconds default per handler
                try {
                    console.log(`Cleaning up: ${handler.name}...`);
                    // Create a timeout promise
                    const timeoutPromise = new Promise((_, reject) => {
                        setTimeout(() => reject(new Error(`Timeout: ${handler.name}`)), handlerTimeout);
                    });
                    // Race between cleanup and timeout
                    await Promise.race([
                        handler.cleanup(),
                        timeoutPromise
                    ]);
                    console.log(`✓ ${handler.name} cleaned up successfully`);
                }
                catch (error) {
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
        }
        catch (error) {
            console.error('Error during shutdown:', error);
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