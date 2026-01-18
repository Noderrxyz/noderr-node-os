import { eventBus, EventTopics } from "@noderr/core";
import { MarketDataService } from "@noderr/market-data";
import { StrategyService } from "@noderr/strategy";
import { SmartExecutionEngine, ExecutionConfig } from "@noderr/execution";
import { PerformanceTracker } from "@noderr/performance";
import { ReputationSystem } from "@noderr/reputation";
import { MLTrainingDataCollector } from "@noderr/performance";

describe("Noderr Testnet End-to-End Simulation", () => {
    let marketDataService: MarketDataService;
    let strategyService: StrategyService;
    let executionEngine: SmartExecutionEngine;
    let performanceTracker: PerformanceTracker;
    let reputationSystem: ReputationSystem;
    let mlDataCollector: MLTrainingDataCollector;

    beforeAll(() => {
        // Disable schema validation for testing
        eventBus.setValidationEnabled(false);
        
        // Initialize all services
        marketDataService = new MarketDataService({ exchanges: ["mock"], symbols: ["BTC/USDT"] });
        strategyService = new StrategyService({ strategies: ["test-strategy"] });
        const execConfig: ExecutionConfig = {
            maxOrderSize: 100,
            minOrderSize: 1,
            maxSlippageBps: 50,
            orderTimeout: 5000,
            enableSmartRouting: false,
            enableOrderSlicing: true,
            venuePriorities: { mock: 1 },
        };
        executionEngine = new SmartExecutionEngine(execConfig);
        performanceTracker = new PerformanceTracker();
        reputationSystem = new ReputationSystem();
        mlDataCollector = new MLTrainingDataCollector();

        // Start all services
        strategyService.start();
        executionEngine.initialize();
        performanceTracker.start();
        reputationSystem.start();
        mlDataCollector.start();
    });

    // MEDIUM FIX #99: Cleanup moved to end of test to avoid timeout issues

    test("should run the full simulation loop from market data to reputation scoring", (done) => {
        let marketDataPublished = false;
        let signalPublished = false;
        let orderExecuted = false;
        let pnlUpdated = false;
        let reputationUpdated = false;

        eventBus.subscribe("market.data.candle", (event) => { 
            marketDataPublished = true; 
        }, "test-listener");
        eventBus.subscribe("strategy.signal", (event) => { 
            signalPublished = true; 
        }, "test-listener");
        eventBus.subscribe("order.executed", (event) => { 
            orderExecuted = true; 
        }, "test-listener");
        eventBus.subscribe("pnl.update", (event) => { 
            pnlUpdated = true; 
        }, "test-listener");
        eventBus.subscribe("reputation.trust_fingerprint.update", (event) => {
            reputationUpdated = true;

            // End the test once the full loop is complete
            expect(marketDataPublished).toBe(true);
            expect(signalPublished).toBe(true);
            expect(orderExecuted).toBe(true);
            expect(pnlUpdated).toBe(true);
            expect(reputationUpdated).toBe(true);
            
            // MEDIUM FIX #99: Cleanup after test completes
            setTimeout(async () => {
                try {
                    if (marketDataService) {
                        await marketDataService.disconnect();
                    }
                    eventBus.reset();
                } catch (error) {
                    // Ignore cleanup errors
                }
            }, 50);
            
            done();
        }, "test-listener");

        // Add a small delay to ensure all subscriptions are registered
        setTimeout(async () => {
            // Start the simulation
            await marketDataService.startSimulation({
            symbols: ["BTC/USDT"],
            interval: "1m",
            startTime: Date.now() - 1000 * 60 * 60, // 1 hour ago
            endTime: Date.now(),
            speed: 1000, // 1000x speed
            });
        }, 100); // 100ms delay to ensure subscriptions are registered
    }, 30000); // 30-second timeout for the test
});
