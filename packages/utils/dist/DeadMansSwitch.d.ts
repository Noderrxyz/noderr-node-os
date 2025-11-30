import { EventEmitter } from 'events';
export interface DeadMansSwitchConfig {
    name: string;
    timeoutMs: number;
    warningThresholdMs?: number;
    maxMissedBeats?: number;
    autoRecover?: boolean;
    action: () => Promise<void>;
    warningAction?: () => Promise<void>;
}
export interface SwitchStatus {
    name: string;
    active: boolean;
    lastHeartbeat: Date | null;
    missedBeats: number;
    triggered: boolean;
    triggerCount: number;
    timeUntilTrigger: number;
    warningIssued: boolean;
}
export declare class DeadMansSwitch extends EventEmitter {
    private logger;
    private config;
    private timer?;
    private warningTimer?;
    private lastHeartbeat;
    private missedBeats;
    private triggered;
    private triggerCount;
    private warningIssued;
    private active;
    constructor(config: DeadMansSwitchConfig);
    /**
     * Start the dead man's switch
     */
    start(): void;
    /**
     * Stop the dead man's switch
     */
    stop(): void;
    /**
     * Send a heartbeat to reset the timer
     */
    heartbeat(metadata?: any): void;
    /**
     * Get current status
     */
    getStatus(): SwitchStatus;
    /**
     * Force trigger the switch manually
     */
    forceTrigger(reason: string): Promise<void>;
    /**
     * Update configuration
     */
    updateConfig(updates: Partial<DeadMansSwitchConfig>): void;
    private scheduleTimeout;
    private resetTimers;
    private issueWarning;
    private handleTimeout;
    private trigger;
    private getTimeUntilTrigger;
    /**
     * Destroy and clean up
     */
    destroy(): void;
}
//# sourceMappingURL=DeadMansSwitch.d.ts.map