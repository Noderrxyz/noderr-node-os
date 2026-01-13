/**
 * State Persistence Utility
 *
 * Provides a standardized way to persist and recover service state.
 *
 * Features:
 * - Atomic writes (write to temp, then rename)
 * - Automatic backup rotation
 * - JSON serialization with compression
 * - State versioning
 * - Corruption detection
 * - Automatic recovery
 */
export interface StateMetadata {
    version: string;
    timestamp: number;
    checksum: string;
    compressed: boolean;
}
export interface PersistedState<T> {
    metadata: StateMetadata;
    data: T;
}
export interface StatePersistenceConfig {
    stateDir: string;
    serviceName: string;
    maxBackups?: number;
    compress?: boolean;
    autoSave?: boolean;
    autoSaveInterval?: number;
}
/**
 * State Persistence Manager
 */
export declare class StatePersistenceManager<T = any> {
    private config;
    private stateFile;
    private autoSaveTimer?;
    private currentState;
    constructor(config: StatePersistenceConfig);
    /**
     * Initialize state directory
     */
    initialize(): Promise<void>;
    /**
     * Save state to disk
     */
    save(state: T, version?: string): Promise<void>;
    /**
     * Load state from disk
     */
    load(): Promise<T | null>;
    /**
     * Load state from most recent backup
     */
    private loadFromBackup;
    /**
     * Rotate backups
     */
    private rotateBackups;
    /**
     * Start auto-save timer
     */
    private startAutoSave;
    /**
     * Stop auto-save timer
     */
    stopAutoSave(): void;
    /**
     * Get current state
     */
    getCurrentState(): T | null;
}
/**
 * Helper function to create a state persistence manager
 */
export declare function createStatePersistence<T>(config: StatePersistenceConfig): StatePersistenceManager<T>;
//# sourceMappingURL=state-persistence.d.ts.map