/**
 * ExecutionTelemetryIntegration - Integrates execution events with telemetry system
 * 
 * This module bridges the ExecutionOptimizer with the telemetry layer
 */

import { EventEmitter } from 'events';
import { 
  Order, 
  ExecutionResult, 
  MarketCondition,
  ExecutionStatus,
  ExecutionErrorCode 
} from '@noderr/types';

export interface TelemetryMetrics {
  ordersReceived: number;
  ordersExecuted: number;
  ordersFailed: number;
  ordersCancelled: number;
  ordersConverted: number;
  activeOrders: number;
  avgSlippage: number;
  avgLatency: number;
  emergencyStops: number;
}

export class ExecutionTelemetryIntegration extends EventEmitter {
  private metrics: TelemetryMetrics;
  private performanceWindow: ExecutionResult[] = [];
  private windowSize = 100; // Keep last 100 executions for averages
  
  constructor() {
    super();
    this.metrics = {
      ordersReceived: 0,
      ordersExecuted: 0,
      ordersFailed: 0,
      ordersCancelled: 0,
      ordersConverted: 0,
      activeOrders: 0,
      avgSlippage: 0,
      avgLatency: 0,
      emergencyStops: 0
    };
  }
  
  // Order lifecycle events
  recordOrderReceived(order: Order): void {
    this.metrics.ordersReceived++;
    this.metrics.activeOrders++;
    
    this.emit('telemetry:order_received', {
      orderId: order.id,
      symbol: order.symbol,
      side: order.side,
      type: order.type,
      quantity: order.quantity,
      isSimulation: order.metadata?.isSimulation || false,
      timestamp: Date.now()
    });
  }
  
  recordOrderValidated(order: Order): void {
    this.emit('telemetry:order_validated', {
      orderId: order.id,
      symbol: order.symbol,
      timestamp: Date.now()
    });
  }
  
  recordOrderRouted(order: Order, routing: any): void {
    this.emit('telemetry:order_routed', {
      orderId: order.id,
      symbol: order.symbol,
      routeCount: routing.routes?.length || 0,
      expectedSlippage: routing.expectedSlippage,
      confidence: routing.confidence,
      timestamp: Date.now()
    });
  }
  
  recordOrderExecuted(result: ExecutionResult): void {
    this.metrics.ordersExecuted++;
    this.metrics.activeOrders = Math.max(0, this.metrics.activeOrders - 1);
    
    // Update performance window
    this.performanceWindow.push(result);
    if (this.performanceWindow.length > this.windowSize) {
      this.performanceWindow.shift();
    }
    
    // Update averages
    this.updateAverages();
    
    const slippageBps = result.performance.slippageBps;
    const costBps = (result.performance.totalCost / (result.totalQuantity * result.averagePrice)) * 10000;
    
    this.emit('telemetry:order_executed', {
      orderId: result.orderId,
      status: result.status,
      symbol: result.fills[0]?.symbol || 'unknown',
      side: result.fills[0]?.side || 'unknown',
      exchange: result.routes[0]?.exchange || 'unknown',
      executionTime: result.executionTime,
      slippageBps,
      costBps,
      fillRate: result.performance.fillRate,
      timestamp: Date.now()
    });
    
    // Emit alerts for high metrics
    if (slippageBps > 50) {
      this.emit('telemetry:alert', {
        type: 'HIGH_SLIPPAGE',
        orderId: result.orderId,
        value: slippageBps,
        threshold: 50,
        severity: 'warning'
      });
    }
    
    if (result.executionTime > 1000) {
      this.emit('telemetry:alert', {
        type: 'HIGH_LATENCY',
        orderId: result.orderId,
        value: result.executionTime,
        threshold: 1000,
        severity: 'warning'
      });
    }
    
    if (costBps > 100) {
      this.emit('telemetry:alert', {
        type: 'HIGH_COST',
        orderId: result.orderId,
        value: costBps,
        threshold: 100,
        severity: 'warning'
      });
    }
  }
  
  recordOrderFailed(orderId: string, error: any, order?: Order): void {
    this.metrics.ordersFailed++;
    if (order) {
      this.metrics.activeOrders = Math.max(0, this.metrics.activeOrders - 1);
    }
    
    const errorCode = error.code || ExecutionErrorCode.EXCHANGE_ERROR;
    
    this.emit('telemetry:order_failed', {
      orderId,
      symbol: order?.symbol || 'unknown',
      exchange: order?.exchange || 'unknown',
      errorCode,
      errorMessage: error.message,
      timestamp: Date.now()
    });
  }
  
  recordOrderCancelled(orderId: string, reason: string, order?: Order): void {
    this.metrics.ordersCancelled++;
    if (order) {
      this.metrics.activeOrders = Math.max(0, this.metrics.activeOrders - 1);
    }
    
    this.emit('telemetry:order_cancelled', {
      orderId,
      symbol: order?.symbol || 'unknown',
      reason,
      timestamp: Date.now()
    });
  }
  
  // Safety events
  recordSafetyModeEnforced(order: Order, mode: string, action: string): void {
    if (action === 'converted') {
      this.metrics.ordersConverted++;
    }
    
    this.emit('telemetry:safety_enforced', {
      orderId: order.id,
      symbol: order.symbol,
      mode,
      action,
      timestamp: Date.now()
    });
  }
  
  recordOrderConverted(order: Order, fromMode: string, toMode: string): void {
    this.metrics.ordersConverted++;
    
    this.emit('telemetry:order_converted', {
      orderId: order.id,
      symbol: order.symbol,
      fromMode,
      toMode,
      timestamp: Date.now()
    });
  }
  
  recordEmergencyStop(ordersAffected: number, reason: string): void {
    this.metrics.emergencyStops++;
    
    this.emit('telemetry:emergency_stop', {
      ordersAffected,
      reason,
      timestamp: Date.now()
    });
    
    this.emit('telemetry:alert', {
      type: 'EMERGENCY_STOP',
      value: ordersAffected,
      message: reason,
      severity: 'critical'
    });
  }
  
  recordTradingModeChange(oldMode: string, newMode: string, operator: string): void {
    this.emit('telemetry:trading_mode_changed', {
      oldMode,
      newMode,
      operator,
      timestamp: Date.now()
    });
  }
  
  updateTradingMode(mode: 'SIMULATION' | 'PAUSED' | 'LIVE'): void {
    // Track current trading mode for metrics
    this.emit('telemetry:trading_mode_updated', {
      mode,
      timestamp: Date.now()
    });
  }
  
  // Market events
  recordMarketConditionChange(oldCondition: MarketCondition, newCondition: MarketCondition): void {
    this.emit('telemetry:market_condition_changed', {
      oldCondition,
      newCondition,
      timestamp: Date.now()
    });
    
    if (newCondition === MarketCondition.EXTREME) {
      this.emit('telemetry:alert', {
        type: 'EXTREME_MARKET_CONDITION',
        message: 'Market condition changed to EXTREME',
        severity: 'critical'
      });
    }
  }
  
  recordLiquidityUpdate(symbol: string, exchange: string, score: number): void {
    this.emit('telemetry:liquidity_update', {
      symbol,
      exchange,
      score,
      timestamp: Date.now()
    });
    
    if (score < 30) {
      this.emit('telemetry:alert', {
        type: 'LOW_LIQUIDITY',
        symbol,
        exchange,
        value: score,
        threshold: 30,
        severity: 'warning'
      });
    }
  }
  
  // Algorithm events
  recordAlgorithmSelection(orderId: string, algorithm: string, confidence: number): void {
    this.emit('telemetry:algorithm_selected', {
      orderId,
      algorithm,
      confidence,
      timestamp: Date.now()
    });
  }
  
  recordAlgorithmPerformance(algorithm: string, metrics: any): void {
    this.emit('telemetry:algorithm_performance', {
      algorithm,
      metrics,
      timestamp: Date.now()
    });
  }
  
  // MEV events
  recordMEVAttackDetected(orderId: string, attackType: string): void {
    this.emit('telemetry:mev_attack_detected', {
      orderId,
      attackType,
      timestamp: Date.now()
    });
    
    this.emit('telemetry:alert', {
      type: 'MEV_ATTACK',
      orderId,
      attackType,
      severity: 'error'
    });
  }
  
  recordMEVProtectionApplied(orderId: string, strategy: string): void {
    this.emit('telemetry:mev_protection_applied', {
      orderId,
      strategy,
      timestamp: Date.now()
    });
  }
  
  recordMEVSavings(orderId: string, savedAmount: number): void {
    this.emit('telemetry:mev_savings', {
      orderId,
      savedAmount,
      timestamp: Date.now()
    });
  }
  
  // Get current metrics
  getMetrics(): TelemetryMetrics {
    return { ...this.metrics };
  }
  
  // Reset metrics (useful for testing)
  resetMetrics(): void {
    this.metrics = {
      ordersReceived: 0,
      ordersExecuted: 0,
      ordersFailed: 0,
      ordersCancelled: 0,
      ordersConverted: 0,
      activeOrders: 0,
      avgSlippage: 0,
      avgLatency: 0,
      emergencyStops: 0
    };
    this.performanceWindow = [];
  }
  
  private updateAverages(): void {
    if (this.performanceWindow.length === 0) {
      this.metrics.avgSlippage = 0;
      this.metrics.avgLatency = 0;
      return;
    }
    
    const totalSlippage = this.performanceWindow.reduce(
      (sum, result) => sum + result.performance.slippageBps, 
      0
    );
    const totalLatency = this.performanceWindow.reduce(
      (sum, result) => sum + result.executionTime, 
      0
    );
    
    this.metrics.avgSlippage = totalSlippage / this.performanceWindow.length;
    this.metrics.avgLatency = totalLatency / this.performanceWindow.length;
  }
} 