import { EventEmitter } from 'events';
import * as winston from 'winston';
export interface RiskLimitConfig {
    basePositionLimit: number;
    baseExposureLimit: number;
    baseLeverageLimit: number;
    baseDrawdownLimit: number;
    volatilityWindow: number;
    adjustmentFactor: number;
    updateInterval: number;
}
export interface MarketConditions {
    volatility: number;
    volume: number;
    spread: number;
    correlation: number;
    regime: 'normal' | 'stressed' | 'crisis';
}
export interface RiskLimits {
    positionLimit: number;
    exposureLimit: number;
    leverageLimit: number;
    drawdownLimit: number;
    orderSizeLimit: number;
    concentrationLimit: number;
    timestamp: Date;
}
export interface RiskMetrics {
    currentExposure: number;
    currentLeverage: number;
    currentDrawdown: number;
    var95: number;
    var99: number;
    stressTestResult: number;
    marginUsage: number;
}
export interface RiskViolation {
    type: 'position' | 'exposure' | 'leverage' | 'drawdown' | 'concentration';
    current: number;
    limit: number;
    severity: 'warning' | 'critical';
    timestamp: Date;
    action: 'block' | 'reduce' | 'alert';
}
export declare class DynamicRiskLimits extends EventEmitter {
    private logger;
    private config;
    private currentLimits;
    private marketConditions;
    private historicalVolatility;
    private updateInterval;
    private riskMetrics;
    private lazyMetrics;
    private violationCheckTimeout;
    private readonly VIOLATION_CHECK_DEBOUNCE;
    private pendingViolationChecks;
    private updateLock;
    private metricsUpdateQueue;
    constructor(logger: winston.Logger, config: RiskLimitConfig);
    start(): void;
    stop(): void;
    updateMarketConditions(conditions: Partial<MarketConditions>): void;
    updateRiskMetrics(metrics: Partial<RiskMetrics>): Promise<void>;
    private scheduleViolationCheck;
    private updateRiskLimits;
    private calculateVolatilityMultiplier;
    private getRegimeMultiplier;
    private calculateCorrelationAdjustment;
    private detectMarketRegime;
    private hasSignificantChange;
    private checkRiskViolations;
    canTakePosition(symbol: string, size: number, currentPositions: Map<string, number>): Promise<boolean>;
    calculateRequiredMargin(positions: Map<string, number>, prices: Map<string, number>): number;
    performStressTest(positions: Map<string, number>, scenarios: StressScenario[]): number;
    getCurrentLimits(): RiskLimits;
    getMarketConditions(): MarketConditions;
    getRiskMetrics(): RiskMetrics;
    emergencyReduceLimits(factor?: number): void;
    resetToBaseLimits(): void;
}
export interface StressScenario {
    name: string;
    description: string;
    shocks: Map<string, number>;
    defaultShock: number;
    probability: number;
}
//# sourceMappingURL=DynamicRiskLimits.d.ts.map