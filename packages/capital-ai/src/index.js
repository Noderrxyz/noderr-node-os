"use strict";
// Adaptive Capital Allocation AI Module
// Phase 6 of Noderr Protocol Elite Expansion
Object.defineProperty(exports, "__esModule", { value: true });
exports.CAPITAL_AI_VERSION = exports.CapitalStrategyDashboard = exports.PortfolioSentinel = exports.CapitalFlowOptimizer = exports.DynamicWeightAllocator = void 0;
exports.startCapitalAIService = startCapitalAIService;
var DynamicWeightAllocator_1 = require("./DynamicWeightAllocator");
Object.defineProperty(exports, "DynamicWeightAllocator", { enumerable: true, get: function () { return DynamicWeightAllocator_1.DynamicWeightAllocator; } });
var CapitalFlowOptimizer_1 = require("./CapitalFlowOptimizer");
Object.defineProperty(exports, "CapitalFlowOptimizer", { enumerable: true, get: function () { return CapitalFlowOptimizer_1.CapitalFlowOptimizer; } });
var PortfolioSentinel_1 = require("./PortfolioSentinel");
Object.defineProperty(exports, "PortfolioSentinel", { enumerable: true, get: function () { return PortfolioSentinel_1.PortfolioSentinel; } });
var CapitalStrategyDashboard_1 = require("./CapitalStrategyDashboard");
Object.defineProperty(exports, "CapitalStrategyDashboard", { enumerable: true, get: function () { return CapitalStrategyDashboard_1.CapitalStrategyDashboard; } });
// Version
exports.CAPITAL_AI_VERSION = '1.0.0';
// ============================================================================
// Main Entry Point
// ============================================================================
const utils_1 = require("@noderr/utils");
const utils_2 = require("@noderr/utils");
let capitalAIService = null;
async function startCapitalAIService() {
    const logger = new utils_1.Logger('CapitalAIService');
    try {
        logger.info('Starting Capital AI Service...');
        // TODO: Initialize Capital AI components when implementation is complete
        // - DynamicWeightAllocator
        // - CapitalFlowOptimizer
        // - PortfolioSentinel
        (0, utils_2.onShutdown)('capital-ai-service', async () => {
            logger.info('Shutting down capital AI service...');
            // TODO: Implement cleanup
            // - Save portfolio state
            // - Close connections
            logger.info('Capital AI service shut down complete');
        }, 10000);
        logger.info('Capital AI Service started successfully');
        await new Promise(() => { });
    }
    catch (error) {
        logger.error('Failed to start Capital AI Service', error);
        throw error;
    }
}
if (require.main === module) {
    (0, utils_2.getShutdownHandler)(30000);
    startCapitalAIService().catch((error) => {
        console.error('Fatal error starting Capital AI Service:', error);
        process.exit(1);
    });
}
