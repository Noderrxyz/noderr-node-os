"use strict";
/**
 * Health Check Module
 * Simple health check for Docker HEALTHCHECK directive
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.healthCheck = healthCheck;
function healthCheck() {
    try {
        // Basic health check - can be extended with more sophisticated checks
        const memoryUsage = process.memoryUsage();
        const heapUsedPercent = (memoryUsage.heapUsed / memoryUsage.heapTotal) * 100;
        // Fail if heap usage is above 95%
        if (heapUsedPercent > 95) {
            console.error(`Health check failed: High memory usage (${heapUsedPercent.toFixed(2)}%)`);
            return false;
        }
        // Check if process has been running for at least 1 second
        if (process.uptime() < 1) {
            console.error('Health check failed: Process just started');
            return false;
        }
        return true;
    }
    catch (error) {
        console.error('Health check error:', error);
        return false;
    }
}
// If run directly (for Docker HEALTHCHECK)
if (require.main === module) {
    const healthy = healthCheck();
    process.exit(healthy ? 0 : 1);
}
//# sourceMappingURL=health-check.js.map