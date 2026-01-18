#!/usr/bin/env node

import { SafetyController } from './SafetyController';
import { LiveTradingReactivationService } from './LiveTradingReactivationService';
// import { UnifiedCapitalManager } from '../../capital-management/src/UnifiedCapitalManager';
import * as fs from 'fs';
import * as path from 'path';

const args = process.argv.slice(2);
const command = args[0];

// Initialize services
const safetyController = SafetyController.getInstance();
const reactivationService = LiveTradingReactivationService.getInstance();
// const capitalManager = UnifiedCapitalManager.getInstance();

// Helper to print status
function printStatus(): void {
  console.log('\n' + safetyController.getCliStatus());
  console.log('\n' + reactivationService.getStatusReport());
}

// Helper to print capital allocation
function printCapitalAllocation(): void {
  console.log('\nCapital allocation view not available (capital-management package not integrated yet)');
  /*
  const allocation = capitalManager.getCapitalAllocationView();
  
  console.log('\n╔════════════════════════════════════════╗');
  console.log('║         CAPITAL ALLOCATION             ║');
  console.log('╠════════════════════════════════════════╣');
  console.log(`║ Total Capital:    $${allocation.totalCapital.toLocaleString().padEnd(20)} ║`);
  console.log(`║ Reserve Capital:  $${allocation.reserveCapital.toLocaleString().padEnd(20)} ║`);
  console.log(`║ Allocated:        $${allocation.allocatedCapital.toLocaleString().padEnd(20)} ║`);
  console.log(`║ Locked:           $${allocation.lockedCapital.toLocaleString().padEnd(20)} ║`);
  console.log(`║ Active Agents:    ${String(allocation.activeAgentCount).padEnd(21)} ║`);
  console.log('╚════════════════════════════════════════╝');
  
  if (allocation.agentAllocations.length > 0) {
    console.log('\nAgent Allocations:');
    console.table(allocation.agentAllocations.map(a => ({
      'Agent ID': a.agentId,
      'Strategy': a.strategyId,
      'Allocated': `$${a.allocated.toLocaleString()}`,
      'Available': `$${a.available.toLocaleString()}`,
      'Locked': `$${a.locked.toLocaleString()}`,
      'P&L': `$${a.performance.toFixed(2)}`,
      'Status': a.status
    })));
  }
  */
}

// Command handlers
async function handleCommand(): Promise<void> {
  switch (command) {
    case 'status':
      printStatus();
      break;
      
    case 'set-mode':
      const mode = args[1]?.toUpperCase();
      const reason = args.slice(2).join(' ') || 'CLI command';
      
      if (!mode || !['SIMULATION', 'PAUSED', 'LIVE'].includes(mode)) {
        console.error('❌ Invalid mode. Use: SIMULATION, PAUSED, or LIVE');
        process.exit(1);
      }
      
      if (mode === 'LIVE') {
        console.warn('\n⚠️  WARNING: Enabling LIVE trading mode with real money!');
        console.log('Press Ctrl+C to cancel, or wait 5 seconds to continue...');
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
      
      const success = await safetyController.setTradingMode(
        mode as any,
        reason,
        'CLI User'
      );
      
      if (success) {
        console.log(`✅ Trading mode changed to ${mode}`);
        printStatus();
      } else {
        console.error('❌ Failed to change trading mode');
        process.exit(1);
      }
      break;
      
    case 'emergency-stop':
      const stopReason = args.slice(1).join(' ') || 'Manual emergency stop';
      await safetyController.emergencyStop(stopReason);
      console.log('🚨 EMERGENCY STOP ACTIVATED');
      break;
      
    case 'capital':
      printCapitalAllocation();
      break;
      
    case 'decommission':
      console.error('❌ Decommission command not available (capital-management package not integrated yet)');
      process.exit(1);
      /*
      const agentId = args[1];
      const strategy = args[2] || 'OPTIMAL';
      
      if (!agentId) {
        console.error('❌ Agent ID required');
        process.exit(1);
      }
      
      try {
        const result = await capitalManager.decommissionAgent(agentId, {
          reason: 'CLI decommission',
          liquidationStrategy: strategy as any
        });
        
        console.log(`✅ Agent ${agentId} decommissioned`);
        console.log(`   Recalled capital: $${result.recalledCapital.toFixed(2)}`);
        console.log(`   Total P&L: $${result.totalPnL.toFixed(2)}`);
      } catch (error: any) {
        console.error(`❌ Failed to decommission: ${error.message}`);
        process.exit(1);
      }
      */
      break;
      
    case 'update-criteria':
      const criteriaType = args[1];
      const value = args[2];
      
      const updates: any = {};
      
      switch (criteriaType) {
        case 'backtest':
          updates.backtestPassed = value === 'true';
          break;
        case 'sharpe':
          updates.paperTradingSharpe = parseFloat(value);
          break;
        case 'days':
          updates.paperTradingDays = parseInt(value);
          break;
        case 'chaos':
          updates.chaosTestsPassed = value === 'true';
          break;
        default:
          console.error('❌ Unknown criteria type');
          process.exit(1);
      }
      
      reactivationService.updateCriteria(updates);
      console.log('✅ Criteria updated');
      printStatus();
      break;
      
    case 'approve-reactivation':
      const notes = args.slice(1).join(' ');
      await reactivationService.provideManualApproval('CLI User', notes);
      console.log('✅ Manual approval provided');
      printStatus();
      break;
      
    case 'request-reactivation':
      const reqNotes = args.slice(1).join(' ');
      const result = await reactivationService.requestReactivation('CLI User', reqNotes);
      
      if (result.success) {
        console.log('✅ Live trading reactivated!');
      } else {
        console.error(`❌ Reactivation failed: ${result.reason}`);
        if (result.evaluation) {
          console.log('\nMissing criteria:');
          result.evaluation.missingCriteria.forEach((c: string) => 
            console.log(`  • ${c}`)
          );
        }
      }
      break;
      
    case 'audit-log':
      const lines = parseInt(args[1]) || 50;
      const auditPath = path.join(process.cwd(), 'SAFETY_AUDIT_LOG.jsonl');
      
      if (fs.existsSync(auditPath)) {
        const content = fs.readFileSync(auditPath, 'utf8');
        const entries = content.trim().split('\n')
          .map(line => JSON.parse(line))
          .slice(-lines);
        
        console.log(`\nLast ${lines} audit entries:`);
        entries.forEach(entry => {
          console.log(`[${entry.timestamp}] ${entry.type}: ${JSON.stringify(entry)}`);
        });
      } else {
        console.log('No audit log found');
      }
      break;
      
    case 'help':
    default:
      console.log(`
Noderr Safety Control CLI

Usage: npm run safety:cli <command> [options]

Commands:
  status                        Show current safety status
  set-mode <mode> [reason]      Set trading mode (SIMULATION, PAUSED, LIVE)
  emergency-stop [reason]       Trigger emergency stop
  capital                       Show capital allocation
  decommission <agentId> [strategy]  Decommission an agent
  update-criteria <type> <value>     Update reactivation criteria
    - backtest true/false
    - sharpe <number>
    - days <number>
    - chaos true/false
  approve-reactivation [notes]  Provide manual approval
  request-reactivation [notes]  Request live trading reactivation
  audit-log [lines]            Show audit log entries
  help                         Show this help message

Examples:
  npm run safety:cli status
  npm run safety:cli set-mode SIMULATION "Testing new strategy"
  npm run safety:cli capital
  npm run safety:cli update-criteria sharpe 2.5
`);
      break;
  }
}

// Main execution
(async () => {
  try {
    await handleCommand();
    process.exit(0);
  } catch (error: any) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
})(); 