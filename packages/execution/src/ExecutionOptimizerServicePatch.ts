/**
 * Patch for ExecutionOptimizerService to integrate SafetyController
 * This file contains the modifications needed to respect trading mode controls
 */

import { SafetyController } from '@noderr/safety-control';
import { Order, ExecutionError, ExecutionErrorCode } from '@noderr/types';

/**
 * Add this to the ExecutionOptimizerService class properties:
 */
// private safetyController: SafetyController;

/**
 * Add this to the constructor after other initializations:
 */
// this.safetyController = SafetyController.getInstance();
// 
// // Listen for trading mode changes
// this.safetyController.on('mode-changed', (event) => {
//   this.logger.warn('Trading mode changed', event);
//   if (event.newMode === 'PAUSED') {
//     // Cancel all active orders if paused
//     this.cancelAllActiveOrders('Trading mode paused');
//   }
// });
// 
// this.safetyController.on('emergency-stop', async (event) => {
//   this.logger.error('Emergency stop triggered', event);
//   await this.emergencyStopAllOrders(event.reason);
// });

/**
 * Replace the executeOrder method with this safety-aware version:
 */
export async function safeExecuteOrder(
  this: any, // ExecutionOptimizerService instance
  order: Order
): Promise<any> {
  const safetyController = SafetyController.getInstance();
  
  // Check if we can execute live trades
  if (!safetyController.canExecuteLiveTrade()) {
    const mode = safetyController.getTradingMode();
    
    // If not in simulation mode and order isn't marked as simulation, convert it
    if (mode !== 'LIVE' && !order.metadata?.isSimulation) {
      this.logger.warn(
        `Converting order ${order.id} to simulation (mode: ${mode})`,
        {
          orderId: order.id,
          symbol: order.symbol,
          quantity: order.quantity,
          originalType: order.type
        }
      );
      
      // Mark order as simulation
      order.metadata = {
        ...order.metadata,
        isSimulation: true,
        originalMode: mode,
        convertedAt: Date.now()
      };
    }
    
    // If mode is PAUSED, reject the order entirely
    if (mode === 'PAUSED' && !order.metadata?.allowInPausedMode) {
      throw new ExecutionError(
        `Trading is paused. Cannot execute order ${order.id}`,
        ExecutionErrorCode.UNKNOWN
      );
    }
  }
  
  // Log safety status
  this.logger.info('Order safety check passed', {
    orderId: order.id,
    tradingMode: safetyController.getTradingMode(),
    isSimulation: order.metadata?.isSimulation || false,
    canExecuteLive: safetyController.canExecuteLiveTrade()
  });
  
  // Call the original execution logic
  return this._originalExecuteOrder(order);
}

/**
 * Add these helper methods to ExecutionOptimizerService:
 */
export const helperMethods = {
  async cancelAllActiveOrders(reason: string): Promise<void> {
    this.logger.warn(`Cancelling all active orders: ${reason}`);
    
    const activeOrders = Array.from(this.state.activeOrders.values());
    const cancelPromises = activeOrders.map(order => 
      this.cancelOrder(order.id).catch(err => {
        this.logger.error(`Failed to cancel order ${order.id}`, err);
      })
    );
    
    await Promise.all(cancelPromises);
    
    this.logger.info(`Cancelled ${activeOrders.length} orders`);
  },
  
  async emergencyStopAllOrders(reason: string): Promise<void> {
    this.logger.error(`EMERGENCY STOP: ${reason}`);
    
    // First, prevent any new orders
    this.state.isRunning = false;
    
    // Cancel all active orders
    await this.cancelAllActiveOrders(`EMERGENCY: ${reason}`);
    
    // Clear all pending executions
    this.activeExecutions.clear();
    
    // Emit emergency stop event
    this.emit('emergency-stop', {
      reason,
      timestamp: Date.now(),
      ordersAffected: this.state.activeOrders.size
    });
  },
  
  getSimulationStats(): any {
    const simulationOrders = this.executionHistory.filter(
      result => result.metadata?.isSimulation
    );
    
    const totalSimulated = simulationOrders.reduce(
      (sum, result) => sum + (result.totalQuantity * result.averagePrice),
      0
    );
    
    return {
      simulationOrderCount: simulationOrders.length,
      totalSimulatedVolume: totalSimulated,
      averageSimulatedSlippage: simulationOrders.reduce(
        (sum, result) => sum + result.slippage,
        0
      ) / (simulationOrders.length || 1)
    };
  }
};

/**
 * Integration instructions:
 * 
 * 1. Import SafetyController at the top of ExecutionOptimizerService.ts:
 *    import { SafetyController } from '@noderr/safety-control';
 * 
 * 2. Add safetyController property to the class
 * 
 * 3. Initialize in constructor as shown above
 * 
 * 4. Save the original executeOrder method:
 *    private _originalExecuteOrder = this.executeOrder;
 * 
 * 5. Replace executeOrder with the safeExecuteOrder function
 * 
 * 6. Add the helper methods to the class
 * 
 * 7. Update any direct order submissions to respect safety mode
 */

/**
 * Example usage after integration:
 * 
 * const optimizer = new ExecutionOptimizerService(config, logger);
 * const safetyController = SafetyController.getInstance();
 * 
 * // Set to simulation mode
 * await safetyController.setTradingMode('SIMULATION', 'Testing phase');
 * 
 * // This order will be automatically converted to simulation
 * const result = await optimizer.executeOrder({
 *   id: 'order-123',
 *   symbol: 'BTC-USD',
 *   side: 'BUY',
 *   quantity: 1,
 *   type: 'MARKET'
 * });
 * 
 * console.log(result.metadata.isSimulation); // true
 */ 