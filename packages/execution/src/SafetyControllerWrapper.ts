/**
 * SafetyControllerWrapper - Local wrapper for SafetyController
 * 
 * This avoids TypeScript rootDir issues while maintaining the integration
 */

import { EventEmitter } from 'events';

export type TradingMode = 'SIMULATION' | 'PAUSED' | 'LIVE';

export interface SafetyControllerInterface {
  getTradingMode(): TradingMode;
  canExecuteLiveTrade(): boolean;
  setTradingMode(mode: TradingMode, reason: string, operator: string): Promise<boolean>;
  emergencyStop(reason: string): Promise<void>;
  on(event: string, listener: Function): void;
  off(event: string, listener: Function): void;
}

// In production, this would import from a shared package
// For now, we'll create a minimal implementation that can be connected to the real SafetyController
export class SafetyControllerWrapper extends EventEmitter implements SafetyControllerInterface {
  private mode: TradingMode = 'SIMULATION';
  private static instance: SafetyControllerWrapper;
  
  private constructor() {
    super();
  }
  
  public static getInstance(): SafetyControllerWrapper {
    if (!SafetyControllerWrapper.instance) {
      SafetyControllerWrapper.instance = new SafetyControllerWrapper();
    }
    return SafetyControllerWrapper.instance;
  }
  
  getTradingMode(): TradingMode {
    return this.mode;
  }
  
  canExecuteLiveTrade(): boolean {
    return this.mode === 'LIVE';
  }
  
  async setTradingMode(mode: TradingMode, reason: string, operator: string): Promise<boolean> {
    const oldMode = this.mode;
    this.mode = mode;
    
    this.emit('mode-changed', {
      oldMode,
      newMode: mode,
      reason,
      operator,
      timestamp: Date.now()
    });
    
    return true;
  }
  
  async emergencyStop(reason: string): Promise<void> {
    const oldMode = this.mode;
    this.mode = 'PAUSED';
    
    this.emit('emergency-stop', {
      reason,
      timestamp: Date.now()
    });
    
    if (oldMode !== 'PAUSED') {
      this.emit('mode-changed', {
        oldMode,
        newMode: 'PAUSED',
        reason: `Emergency stop: ${reason}`,
        operator: 'system',
        timestamp: Date.now()
      });
    }
  }
  
  isSimulationMode(): boolean {
    return this.mode === 'SIMULATION';
  }
  
  isPaused(): boolean {
    return this.mode === 'PAUSED';
  }
}

// Export a function to connect to the real SafetyController
export function connectToRealSafetyController(realController: any): void {
  const wrapper = SafetyControllerWrapper.getInstance();
  
  // Forward events from real controller to wrapper
  realController.on('mode-changed', (event: any) => {
    (wrapper as any).mode = event.newMode;
    wrapper.emit('mode-changed', event);
  });
  
  realController.on('emergency-stop', (event: any) => {
    (wrapper as any).mode = 'PAUSED';
    wrapper.emit('emergency-stop', event);
  });
  
  // Override wrapper methods to use real controller
  wrapper.getTradingMode = () => realController.getTradingMode();
  wrapper.canExecuteLiveTrade = () => realController.canExecuteLiveTrade();
  wrapper.setTradingMode = (mode, reason, operator) => realController.setTradingMode(mode, reason, operator);
  wrapper.emergencyStop = (reason) => realController.emergencyStop(reason);
} 