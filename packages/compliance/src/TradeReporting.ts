import { Logger } from '@noderr/utils/src';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';

const logger = new Logger('TradeReporting');
const createLogger = (name: string) => ({
  info: (message: string, meta?: any) => logger.info(`[${name}] INFO:`, message, meta || ''),
  error: (message: string, error?: any) => logger.error(`[${name}] ERROR:`, message, error || ''),
  debug: (message: string, meta?: any) => logger.debug(`[${name}] DEBUG:`, message, meta || ''),
  warn: (message: string, meta?: any) => logger.warn(`[${name}] WARN:`, message, meta || '')
});

interface Trade {
  id: string;
  timestamp: Date;
  symbol: string;
  side: 'buy' | 'sell';
  quantity: number;
  price: number;
  venue: string;
  orderId: string;
  strategyId: string;
  executionTime: number; // milliseconds
  fees: {
    amount: number;
    currency: string;
  };
  counterparty?: string;
  settlementDate?: Date;
  metadata?: Record<string, any>;
}

interface RegulatoryReport {
  reportId: string;
  reportType: 'daily' | 'monthly' | 'quarterly' | 'annual' | 'realtime';
  period: {
    start: Date;
    end: Date;
  };
  jurisdiction: string;
  trades: Trade[];
  summary: TradeSummary;
  generatedAt: Date;
  submittedAt?: Date;
  status: 'draft' | 'pending' | 'submitted' | 'accepted' | 'rejected';
  metadata?: Record<string, any>;
}

interface TradeSummary {
  totalTrades: number;
  totalVolume: number;
  totalFees: number;
  byAsset: Record<string, AssetSummary>;
  byVenue: Record<string, VenueSummary>;
  byStrategy: Record<string, StrategySummary>;
  pnl: {
    realized: number;
    unrealized: number;
    fees: number;
    net: number;
  };
}

interface AssetSummary {
  trades: number;
  volume: number;
  buyVolume: number;
  sellVolume: number;
  avgPrice: number;
  fees: number;
}

interface VenueSummary {
  trades: number;
  volume: number;
  fees: number;
  avgLatency: number;
}

interface StrategySummary {
  trades: number;
  volume: number;
  pnl: number;
  winRate: number;
}

interface ComplianceRule {
  id: string;
  name: string;
  type: 'volume' | 'frequency' | 'pattern' | 'wash' | 'layering';
  threshold: any;
  action: 'flag' | 'block' | 'report';
  enabled: boolean;
}

export class TradeReporting extends EventEmitter {
  private logger: ReturnType<typeof createLogger>;
  private trades: Map<string, Trade> = new Map();
  private reports: Map<string, RegulatoryReport> = new Map();
  private complianceRules: Map<string, ComplianceRule> = new Map();
  private reportingQueue: RegulatoryReport[] = [];
  private isProcessing: boolean = false;
  
  constructor() {
    super();
    this.logger = createLogger('TradeReporting');
    this.initializeComplianceRules();
    this.startReportingProcessor();
  }
  
  private initializeComplianceRules(): void {
    const rules: ComplianceRule[] = [
      {
        id: 'high_frequency',
        name: 'High Frequency Trading Detection',
        type: 'frequency',
        threshold: { tradesPerMinute: 100 },
        action: 'flag',
        enabled: true
      },
      {
        id: 'large_volume',
        name: 'Large Volume Detection',
        type: 'volume',
        threshold: { volumeUSD: 1000000 },
        action: 'report',
        enabled: true
      },
      {
        id: 'wash_trading',
        name: 'Wash Trading Detection',
        type: 'wash',
        threshold: { timeWindow: 60000, priceDeviation: 0.001 },
        action: 'block',
        enabled: true
      },
      {
        id: 'layering',
        name: 'Layering Detection',
        type: 'layering',
        threshold: { orders: 10, timeWindow: 5000 },
        action: 'flag',
        enabled: true
      },
      {
        id: 'pattern_day_trading',
        name: 'Pattern Day Trading',
        type: 'pattern',
        threshold: { dayTrades: 4, period: 5 },
        action: 'report',
        enabled: true
      }
    ];
    
    rules.forEach(rule => this.complianceRules.set(rule.id, rule));
  }
  
  public async recordTrade(trade: Trade): Promise<void> {
    this.logger.debug('Recording trade', {
      id: trade.id,
      symbol: trade.symbol,
      side: trade.side,
      quantity: trade.quantity,
      price: trade.price
    });
    
    try {
      // Store trade
      this.trades.set(trade.id, trade);
      
      // Check compliance rules
      const violations = await this.checkCompliance(trade);
      
      if (violations.length > 0) {
        this.logger.warn('Compliance violations detected', {
          tradeId: trade.id,
          violations: violations.map(v => v.name)
        });
        
        for (const violation of violations) {
          await this.handleViolation(trade, violation);
        }
      }
      
      // Emit trade recorded event
      this.emit('trade-recorded', {
        trade,
        violations,
        timestamp: new Date()
      });
      
      // Check if real-time reporting is required
      if (this.requiresRealTimeReporting(trade)) {
        await this.generateRealTimeReport(trade);
      }
      
    } catch (error) {
      this.logger.error('Failed to record trade', error);
      throw error;
    }
  }
  
  private async checkCompliance(trade: Trade): Promise<ComplianceRule[]> {
    const violations: ComplianceRule[] = [];
    
    for (const rule of this.complianceRules.values()) {
      if (!rule.enabled) continue;
      
      const isViolation = await this.checkRule(trade, rule);
      if (isViolation) {
        violations.push(rule);
      }
    }
    
    return violations;
  }
  
  private async checkRule(trade: Trade, rule: ComplianceRule): Promise<boolean> {
    switch (rule.type) {
      case 'volume':
        return this.checkVolumeRule(trade, rule);
      
      case 'frequency':
        return this.checkFrequencyRule(trade, rule);
      
      case 'wash':
        return this.checkWashTradingRule(trade, rule);
      
      case 'layering':
        return this.checkLayeringRule(trade, rule);
      
      case 'pattern':
        return this.checkPatternRule(trade, rule);
      
      default:
        return false;
    }
  }
  
  private checkVolumeRule(trade: Trade, rule: ComplianceRule): boolean {
    const volumeUSD = trade.quantity * trade.price;
    return volumeUSD > rule.threshold.volumeUSD;
  }
  
  private checkFrequencyRule(trade: Trade, rule: ComplianceRule): boolean {
    const recentTrades = this.getRecentTrades(60000); // Last minute
    const tradeCount = recentTrades.filter(t => t.strategyId === trade.strategyId).length;
    return tradeCount > rule.threshold.tradesPerMinute;
  }
  
  private checkWashTradingRule(trade: Trade, rule: ComplianceRule): boolean {
    if (trade.side !== 'sell') return false;
    
    const recentTrades = this.getRecentTrades(rule.threshold.timeWindow);
    const oppositeTrades = recentTrades.filter(t => 
      t.symbol === trade.symbol &&
      t.side === 'buy' &&
      t.strategyId === trade.strategyId &&
      Math.abs(t.price - trade.price) / trade.price < rule.threshold.priceDeviation
    );
    
    return oppositeTrades.length > 0;
  }
  
  private checkLayeringRule(trade: Trade, rule: ComplianceRule): boolean {
    // Simplified layering detection
    const recentTrades = this.getRecentTrades(rule.threshold.timeWindow);
    const sameSideTrades = recentTrades.filter(t => 
      t.symbol === trade.symbol &&
      t.side === trade.side &&
      t.strategyId === trade.strategyId
    );
    
    return sameSideTrades.length > rule.threshold.orders;
  }
  
  private checkPatternRule(trade: Trade, rule: ComplianceRule): boolean {
    // Check for pattern day trading
    const dayTrades = this.getDayTrades(rule.threshold.period);
    const symbols = new Set(dayTrades.map(t => t.symbol));
    
    for (const symbol of symbols) {
      const symbolTrades = dayTrades.filter(t => t.symbol === symbol);
      const buyTrades = symbolTrades.filter(t => t.side === 'buy');
      const sellTrades = symbolTrades.filter(t => t.side === 'sell');
      
      const roundTrips = Math.min(buyTrades.length, sellTrades.length);
      if (roundTrips >= rule.threshold.dayTrades) {
        return true;
      }
    }
    
    return false;
  }
  
  private getRecentTrades(timeWindow: number): Trade[] {
    const cutoff = Date.now() - timeWindow;
    return Array.from(this.trades.values())
      .filter(t => t.timestamp.getTime() > cutoff);
  }
  
  private getDayTrades(days: number): Trade[] {
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    return Array.from(this.trades.values())
      .filter(t => t.timestamp.getTime() > cutoff);
  }
  
  private async handleViolation(trade: Trade, rule: ComplianceRule): Promise<void> {
    switch (rule.action) {
      case 'flag':
        this.logger.warn(`Trade flagged for ${rule.name}`, { tradeId: trade.id });
        this.emit('compliance-flag', { trade, rule });
        break;
        
      case 'block':
        this.logger.error(`Trade blocked for ${rule.name}`, { tradeId: trade.id });
        this.emit('compliance-block', { trade, rule });
        throw new Error(`Trade blocked: ${rule.name}`);
        
      case 'report':
        this.logger.info(`Trade reported for ${rule.name}`, { tradeId: trade.id });
        await this.generateComplianceReport(trade, rule);
        break;
    }
  }
  
  private requiresRealTimeReporting(trade: Trade): boolean {
    // Check if trade requires real-time reporting (e.g., large trades)
    const volumeUSD = trade.quantity * trade.price;
    return volumeUSD > 1000000 || trade.venue === 'OTC';
  }
  
  private async generateRealTimeReport(trade: Trade): Promise<void> {
    const report: RegulatoryReport = {
      reportId: `RT_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      reportType: 'realtime',
      period: {
        start: trade.timestamp,
        end: trade.timestamp
      },
      jurisdiction: this.getJurisdiction(trade),
      trades: [trade],
      summary: this.generateSummary([trade]),
      generatedAt: new Date(),
      status: 'pending'
    };
    
    this.reportingQueue.push(report);
    
    this.logger.info('Real-time report generated', {
      reportId: report.reportId,
      tradeId: trade.id
    });
  }
  
  private async generateComplianceReport(trade: Trade, rule: ComplianceRule): Promise<void> {
    const report: RegulatoryReport = {
      reportId: `COMP_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      reportType: 'realtime',
      period: {
        start: trade.timestamp,
        end: trade.timestamp
      },
      jurisdiction: this.getJurisdiction(trade),
      trades: [trade],
      summary: this.generateSummary([trade]),
      generatedAt: new Date(),
      status: 'pending'
    };
    
    // Add compliance metadata
    report.metadata = {
      complianceRule: rule.id,
      violationType: rule.type,
      action: rule.action
    };
    
    this.reportingQueue.push(report);
  }
  
  public async generateDailyReport(date: Date): Promise<RegulatoryReport> {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);
    
    const dayTrades = Array.from(this.trades.values()).filter(t => 
      t.timestamp >= startOfDay && t.timestamp <= endOfDay
    );
    
    const report: RegulatoryReport = {
      reportId: `DAILY_${date.toISOString().split('T')[0]}_${Math.random().toString(36).substr(2, 9)}`,
      reportType: 'daily',
      period: {
        start: startOfDay,
        end: endOfDay
      },
      jurisdiction: 'US', // Default, should be configurable
      trades: dayTrades,
      summary: this.generateSummary(dayTrades),
      generatedAt: new Date(),
      status: 'draft'
    };
    
    this.reports.set(report.reportId, report);
    
    this.logger.info('Daily report generated', {
      reportId: report.reportId,
      date: date.toISOString().split('T')[0],
      trades: dayTrades.length
    });
    
    return report;
  }
  
  private generateSummary(trades: Trade[]): TradeSummary {
    const summary: TradeSummary = {
      totalTrades: trades.length,
      totalVolume: 0,
      totalFees: 0,
      byAsset: {},
      byVenue: {},
      byStrategy: {},
      pnl: {
        realized: 0,
        unrealized: 0,
        fees: 0,
        net: 0
      }
    };
    
    // Calculate aggregates
    trades.forEach(trade => {
      const volumeUSD = trade.quantity * trade.price;
      summary.totalVolume += volumeUSD;
      summary.totalFees += trade.fees.amount;
      
      // By asset
      if (!summary.byAsset[trade.symbol]) {
        summary.byAsset[trade.symbol] = {
          trades: 0,
          volume: 0,
          buyVolume: 0,
          sellVolume: 0,
          avgPrice: 0,
          fees: 0
        };
      }
      
      const assetSummary = summary.byAsset[trade.symbol];
      assetSummary.trades++;
      assetSummary.volume += volumeUSD;
      assetSummary.fees += trade.fees.amount;
      
      if (trade.side === 'buy') {
        assetSummary.buyVolume += volumeUSD;
      } else {
        assetSummary.sellVolume += volumeUSD;
      }
      
      // By venue
      if (!summary.byVenue[trade.venue]) {
        summary.byVenue[trade.venue] = {
          trades: 0,
          volume: 0,
          fees: 0,
          avgLatency: 0
        };
      }
      
      const venueSummary = summary.byVenue[trade.venue];
      venueSummary.trades++;
      venueSummary.volume += volumeUSD;
      venueSummary.fees += trade.fees.amount;
      venueSummary.avgLatency = 
        (venueSummary.avgLatency * (venueSummary.trades - 1) + trade.executionTime) / venueSummary.trades;
      
      // By strategy
      if (!summary.byStrategy[trade.strategyId]) {
        summary.byStrategy[trade.strategyId] = {
          trades: 0,
          volume: 0,
          pnl: 0,
          winRate: 0
        };
      }
      
      const strategySummary = summary.byStrategy[trade.strategyId];
      strategySummary.trades++;
      strategySummary.volume += volumeUSD;
    });
    
    // Calculate average prices
    Object.keys(summary.byAsset).forEach(asset => {
      const assetSummary = summary.byAsset[asset];
      assetSummary.avgPrice = assetSummary.volume / 
        trades.filter(t => t.symbol === asset).reduce((sum, t) => sum + t.quantity, 0);
    });
    
    // Calculate P&L (simplified)
    summary.pnl.fees = -summary.totalFees;
    summary.pnl.realized = this.calculateRealizedPnL(trades);
    summary.pnl.net = summary.pnl.realized + summary.pnl.fees;
    
    return summary;
  }
  
  private calculateRealizedPnL(trades: Trade[]): number {
    // Simplified P&L calculation
    let pnl = 0;
    const positions: Record<string, { quantity: number; avgPrice: number }> = {};
    
    trades.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    
    trades.forEach(trade => {
      if (!positions[trade.symbol]) {
        positions[trade.symbol] = { quantity: 0, avgPrice: 0 };
      }
      
      const position = positions[trade.symbol];
      
      if (trade.side === 'buy') {
        const newQuantity = position.quantity + trade.quantity;
        position.avgPrice = 
          (position.avgPrice * position.quantity + trade.price * trade.quantity) / newQuantity;
        position.quantity = newQuantity;
      } else {
        const realizedPnL = (trade.price - position.avgPrice) * Math.min(trade.quantity, position.quantity);
        pnl += realizedPnL;
        position.quantity = Math.max(0, position.quantity - trade.quantity);
      }
    });
    
    return pnl;
  }
  
  private getJurisdiction(trade: Trade): string {
    // Determine jurisdiction based on venue
    const venueJurisdictions: Record<string, string> = {
      'NASDAQ': 'US',
      'NYSE': 'US',
      'LSE': 'UK',
      'TSE': 'JP',
      'Binance': 'INTL',
      'Coinbase': 'US'
    };
    
    return venueJurisdictions[trade.venue] || 'INTL';
  }
  
  private startReportingProcessor(): void {
    setInterval(async () => {
      if (this.isProcessing || this.reportingQueue.length === 0) return;
      
      this.isProcessing = true;
      
      try {
        const report = this.reportingQueue.shift();
        if (report) {
          await this.submitReport(report);
        }
      } catch (error) {
        this.logger.error('Failed to process report', error);
      } finally {
        this.isProcessing = false;
      }
    }, 5000); // Process every 5 seconds
  }
  
  private async submitReport(report: RegulatoryReport): Promise<void> {
    this.logger.info('Submitting regulatory report', {
      reportId: report.reportId,
      type: report.reportType,
      jurisdiction: report.jurisdiction
    });
    
    try {
      // In production, would submit to regulatory API
      // Mock implementation
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Simulate submission result
      if (Math.random() > 0.1) {
        report.status = 'submitted';
        report.submittedAt = new Date();
        
        // Save to file for audit trail
        await this.saveReportToFile(report);
        
        this.logger.info('Report submitted successfully', { reportId: report.reportId });
        
        this.emit('report-submitted', report);
      } else {
        report.status = 'rejected';
        this.logger.error('Report rejected', { reportId: report.reportId });
        
        this.emit('report-rejected', report);
      }
      
    } catch (error) {
      this.logger.error('Failed to submit report', error);
      report.status = 'rejected';
      throw error;
    }
  }
  
  private async saveReportToFile(report: RegulatoryReport): Promise<void> {
    const reportsDir = path.join(process.cwd(), 'reports', 'regulatory');
    
    // Create directory if it doesn't exist
    if (!fs.existsSync(reportsDir)) {
      fs.mkdirSync(reportsDir, { recursive: true });
    }
    
    const filename = `${report.reportId}_${report.reportType}_${report.jurisdiction}.json`;
    const filepath = path.join(reportsDir, filename);
    
    fs.writeFileSync(filepath, JSON.stringify(report, null, 2));
    
    this.logger.debug('Report saved to file', { filepath });
  }
  
  public async exportTrades(
    startDate: Date,
    endDate: Date,
    format: 'json' | 'csv' = 'json'
  ): Promise<string> {
    const trades = Array.from(this.trades.values()).filter(t => 
      t.timestamp >= startDate && t.timestamp <= endDate
    );
    
    if (format === 'json') {
      return JSON.stringify(trades, null, 2);
    } else {
      // CSV export
      const headers = [
        'ID', 'Timestamp', 'Symbol', 'Side', 'Quantity', 
        'Price', 'Venue', 'Strategy', 'Fees', 'Execution Time'
      ];
      
      const rows = trades.map(t => [
        t.id,
        t.timestamp.toISOString(),
        t.symbol,
        t.side,
        t.quantity,
        t.price,
        t.venue,
        t.strategyId,
        t.fees.amount,
        t.executionTime
      ]);
      
      const csv = [headers, ...rows].map(row => row.join(',')).join('\n');
      
      return csv;
    }
  }
  
  public getTradeMetrics(period: { start: Date; end: Date }): any {
    const trades = Array.from(this.trades.values()).filter(t => 
      t.timestamp >= period.start && t.timestamp <= period.end
    );
    
    return {
      totalTrades: trades.length,
      totalVolume: trades.reduce((sum, t) => sum + t.quantity * t.price, 0),
      avgTradeSize: trades.length > 0 
        ? trades.reduce((sum, t) => sum + t.quantity * t.price, 0) / trades.length 
        : 0,
      totalFees: trades.reduce((sum, t) => sum + t.fees.amount, 0),
      uniqueSymbols: new Set(trades.map(t => t.symbol)).size,
      venues: [...new Set(trades.map(t => t.venue))],
      strategies: [...new Set(trades.map(t => t.strategyId))]
    };
  }
} 