import { EventEmitter } from 'events';
export interface FlowLimit {
    periodMs: number;
    maxAmount: number;
    maxPercentage: number;
}
export interface FlowEvent {
    id: string;
    type: 'INFLOW' | 'OUTFLOW' | 'TRANSFER';
    amount: number;
    from?: string;
    to?: string;
    timestamp: Date;
    description: string;
    approved: boolean;
    rejectionReason?: string;
}
export interface FlowMetrics {
    periodStart: Date;
    periodEnd: Date;
    totalInflow: number;
    totalOutflow: number;
    netFlow: number;
    eventCount: number;
    rejectedCount: number;
    largestFlow: FlowEvent | null;
}
export interface CapitalFlowLimiterConfig {
    totalCapital: number;
    limits: {
        minute?: FlowLimit;
        hour?: FlowLimit;
        day?: FlowLimit;
        custom?: FlowLimit[];
    };
    emergencyStopThreshold?: number;
    warningThreshold?: number;
}
export declare class CapitalFlowLimiter extends EventEmitter {
    private logger;
    private config;
    private flowEvents;
    private metricsCache;
    private emergencyStopTriggered;
    constructor(config: CapitalFlowLimiterConfig);
    /**
     * Validate a capital flow
     */
    validateFlow(type: 'INFLOW' | 'OUTFLOW' | 'TRANSFER', amount: number, description: string, metadata?: {
        from?: string;
        to?: string;
    }): Promise<{
        approved: boolean;
        reason?: string;
        flowEvent: FlowEvent;
    }>;
    /**
     * Get flow metrics for a period
     */
    getMetrics(periodMs: number): FlowMetrics;
    /**
     * Reset emergency stop
     */
    resetEmergencyStop(reason: string): void;
    /**
     * Update total capital
     */
    updateTotalCapital(newTotal: number): void;
    /**
     * Get flow history
     */
    getFlowHistory(filter?: {
        type?: 'INFLOW' | 'OUTFLOW' | 'TRANSFER';
        approved?: boolean;
        startDate?: Date;
        endDate?: Date;
    }): FlowEvent[];
    /**
     * Clear old flow events
     */
    cleanup(olderThanMs?: number): number;
    private generateFlowId;
    private checkLimit;
    private checkWarningThreshold;
    private checkEmergencyThreshold;
    private invalidateMetricsCache;
    /**
     * Get current status
     */
    getStatus(): {
        emergencyStopActive: boolean;
        totalCapital: number;
        recentFlows: {
            minute: FlowMetrics;
            hour: FlowMetrics;
            day: FlowMetrics;
        };
        limits: any;
    };
    /**
     * Destroy and clean up
     */
    destroy(): void;
}
//# sourceMappingURL=CapitalFlowLimiter.d.ts.map