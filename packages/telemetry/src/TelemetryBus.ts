/**
 * TelemetryBus - Simple event bus for telemetry in AI Core
 */

import { EventEmitter } from 'events';

export class TelemetryBus extends EventEmitter {
  private static instance: TelemetryBus | null = null;
  
  private constructor() {
    super();
  }
  
  public static getInstance(): TelemetryBus {
    if (!TelemetryBus.instance) {
      TelemetryBus.instance = new TelemetryBus();
    }
    return TelemetryBus.instance;
  }
  
  emit(event: string, data: any): boolean {
    // Simple telemetry emission
    return super.emit(event, data);
  }
} 