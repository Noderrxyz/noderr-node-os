/**
 * TelemetryBus - Simple event bus for telemetry in AI Core
 */
import { EventEmitter } from 'events';
export declare class TelemetryBus extends EventEmitter {
    private static instance;
    private constructor();
    static getInstance(): TelemetryBus;
    emit(event: string, data: any): boolean;
}
//# sourceMappingURL=TelemetryBus.d.ts.map