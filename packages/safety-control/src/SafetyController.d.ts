import { EventEmitter } from 'events';
export type TradingMode = 'SIMULATION' | 'PAUSED' | 'LIVE';
interface ModeChangeEvent {
    previousMode: TradingMode;
    newMode: TradingMode;
    reason: string;
    timestamp: number;
    authorizedBy?: string;
    approvalSignatures?: string[];
}
interface SafetyCheck {
    name: string;
    check: () => Promise<boolean>;
    critical: boolean;
    description?: string;
}
export declare class SafetyController extends EventEmitter {
    private static instance;
    private logger;
    private tradingMode;
    private modeHistory;
    private safetyChecks;
    private lockFilePath;
    private encryptedLockPath;
    private encryptionKey;
    private constructor();
    static getInstance(): SafetyController;
    private loadOrGenerateEncryptionKey;
    private loadPersistedMode;
    private setupDefaultSafetyChecks;
    setTradingMode(mode: TradingMode, reason: string, authorizedBy?: string, approvalSignatures?: string[]): Promise<boolean>;
    private persistMode;
    private encryptState;
    private decryptState;
    private calculateChecksum;
    private verifyChecksum;
    private appendToAuditLog;
    getTradingMode(): TradingMode;
    canExecuteLiveTrade(): boolean;
    isSimulationMode(): boolean;
    isPaused(): boolean;
    addSafetyCheck(check: SafetyCheck): void;
    runSafetyChecks(): Promise<{
        passed: boolean;
        failedChecks: string[];
    }>;
    getModeHistory(): ModeChangeEvent[];
    getLastModeChange(): ModeChangeEvent | undefined;
    getSafetyStatus(): {
        mode: TradingMode;
        isLiveEnabled: boolean;
        lastChange: ModeChangeEvent | undefined;
        uptime: number;
        checksConfigured: number;
    };
    emergencyStop(reason: string): Promise<void>;
    getCliStatus(): string;
    private formatUptime;
}
export {};
//# sourceMappingURL=SafetyController.d.ts.map