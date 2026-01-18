import { Logger } from '@noderr/utils/src';
import { EventEmitter } from 'events';

const logger = new Logger('CapitalStrategyDashboard');
const createLogger = (name: string) => ({
  info: (message: string, meta?: any) => logger.info(`[${name}] INFO:`, message, meta || ''),
  error: (message: string, error?: any) => logger.error(`[${name}] ERROR:`, message, error || ''),
  debug: (message: string, meta?: any) => logger.debug(`[${name}] DEBUG:`, message, meta || ''),
  warn: (message: string, meta?: any) => logger.warn(`[${name}] WARN:`, message, meta || '')
});

interface DashboardWidget {
  id: string;
  type: 'HEATMAP' | 'PIE_CHART' | 'TIME_SERIES' | 'TABLE' | 'GAUGE' | 'ATTRIBUTION';
  title: string;
  data: any;
  config: WidgetConfig;
  lastUpdated: Date;
}

interface WidgetConfig {
  refreshInterval: number;
  colorScheme: string;
  interactive: boolean;
  exportable: boolean;
  filters?: FilterConfig[];
}

interface FilterConfig {
  field: string;
  type: 'SELECT' | 'RANGE' | 'DATE';
  options?: any[];
  default?: any;
}

interface CapitalUsageData {
  timestamp: Date;
  strategies: Map<string, StrategyCapitalUsage>;
  totalCapital: number;
  deployedCapital: number;
  cashBuffer: number;
  utilizationRate: number;
}

interface StrategyCapitalUsage {
  strategyId: string;
  strategyName: string;
  strategyType: string;
  allocatedCapital: number;
  deployedCapital: number;
  utilizationRate: number;
  performance: {
    pnl: number;
    sharpeRatio: number;
    alpha: number;
    beta: number;
  };
  positions: number;
  risk: {
    var: number;
    maxDrawdown: number;
    currentDrawdown: number;
  };
}

interface AlphaAttribution {
  strategyId: string;
  strategyName: string;
  grossAlpha: number;
  netAlpha: number;
  riskAdjustedAlpha: number;
  attribution: {
    timing: number;
    selection: number;
    allocation: number;
    interaction: number;
  };
  contribution: number;
}

interface HeatmapData {
  rows: string[];
  columns: string[];
  values: number[][];
  metadata: {
    min: number;
    max: number;
    mean: number;
    colorScale: string;
  };
}

interface DashboardMetrics {
  totalAUM: number;
  deployedCapital: number;
  cashReserve: number;
  totalStrategies: number;
  activeStrategies: number;
  overallSharpe: number;
  overallAlpha: number;
  capitalEfficiency: number;
  riskBudgetUsed: number;
}

export class CapitalStrategyDashboard extends EventEmitter {
  private logger: ReturnType<typeof createLogger>;
  private widgets: Map<string, DashboardWidget>;
  private capitalUsageHistory: CapitalUsageData[];
  private alphaAttributions: Map<string, AlphaAttribution>;
  private dashboardMetrics: DashboardMetrics;
  private updateIntervals: Map<string, NodeJS.Timeout>;
  private dataProviders: Map<string, () => Promise<any>>;
  
  constructor() {
    super();
    this.logger = createLogger('CapitalStrategyDashboard');
    this.widgets = new Map();
    this.capitalUsageHistory = [];
    this.alphaAttributions = new Map();
    this.updateIntervals = new Map();
    this.dataProviders = new Map();
    
    this.dashboardMetrics = {
      totalAUM: 0,
      deployedCapital: 0,
      cashReserve: 0,
      totalStrategies: 0,
      activeStrategies: 0,
      overallSharpe: 0,
      overallAlpha: 0,
      capitalEfficiency: 0,
      riskBudgetUsed: 0
    };
    
    this.initializeDashboard();
  }
  
  private initializeDashboard(): void {
    this.createCapitalHeatmap();
    this.createAllocationPieChart();
    this.createAlphaAttributionChart();
    this.createPerformanceTimeSeries();
    this.createRiskGauges();
    this.createStrategyTable();
    
    this.startDataCollection();
    
    this.logger.info('Capital strategy dashboard initialized');
  }
  
  private createCapitalHeatmap(): void {
    const widget: DashboardWidget = {
      id: 'capital-heatmap',
      type: 'HEATMAP',
      title: 'Capital Usage Heatmap',
      data: this.generateHeatmapData(),
      config: {
        refreshInterval: 60000, // 1 minute
        colorScheme: 'viridis',
        interactive: true,
        exportable: true,
        filters: [
          {
            field: 'timeframe',
            type: 'SELECT',
            options: ['1H', '1D', '1W', '1M'],
            default: '1D'
          }
        ]
      },
      lastUpdated: new Date()
    };
    
    this.widgets.set(widget.id, widget);
    this.scheduleWidgetUpdate(widget);
  }
  
  private createAllocationPieChart(): void {
    const widget: DashboardWidget = {
      id: 'allocation-pie',
      type: 'PIE_CHART',
      title: 'Capital Allocation by Strategy Class',
      data: this.generateAllocationData(),
      config: {
        refreshInterval: 30000,
        colorScheme: 'category20',
        interactive: true,
        exportable: true
      },
      lastUpdated: new Date()
    };
    
    this.widgets.set(widget.id, widget);
    this.scheduleWidgetUpdate(widget);
  }
  
  private createAlphaAttributionChart(): void {
    const widget: DashboardWidget = {
      id: 'alpha-attribution',
      type: 'ATTRIBUTION',
      title: 'Risk-Adjusted Alpha Attribution',
      data: this.generateAttributionData(),
      config: {
        refreshInterval: 300000, // 5 minutes
        colorScheme: 'diverging',
        interactive: true,
        exportable: true,
        filters: [
          {
            field: 'period',
            type: 'SELECT',
            options: ['Daily', 'Weekly', 'Monthly', 'YTD'],
            default: 'Monthly'
          }
        ]
      },
      lastUpdated: new Date()
    };
    
    this.widgets.set(widget.id, widget);
    this.scheduleWidgetUpdate(widget);
  }
  
  private createPerformanceTimeSeries(): void {
    const widget: DashboardWidget = {
      id: 'performance-series',
      type: 'TIME_SERIES',
      title: 'Portfolio Performance Over Time',
      data: this.generateTimeSeriesData(),
      config: {
        refreshInterval: 60000,
        colorScheme: 'spectral',
        interactive: true,
        exportable: true,
        filters: [
          {
            field: 'metric',
            type: 'SELECT',
            options: ['PnL', 'Sharpe', 'Drawdown', 'Utilization'],
            default: 'PnL'
          }
        ]
      },
      lastUpdated: new Date()
    };
    
    this.widgets.set(widget.id, widget);
    this.scheduleWidgetUpdate(widget);
  }
  
  private createRiskGauges(): void {
    const widget: DashboardWidget = {
      id: 'risk-gauges',
      type: 'GAUGE',
      title: 'Risk Metrics',
      data: this.generateRiskGaugeData(),
      config: {
        refreshInterval: 10000,
        colorScheme: 'redgreen',
        interactive: false,
        exportable: true
      },
      lastUpdated: new Date()
    };
    
    this.widgets.set(widget.id, widget);
    this.scheduleWidgetUpdate(widget);
  }
  
  private createStrategyTable(): void {
    const widget: DashboardWidget = {
      id: 'strategy-table',
      type: 'TABLE',
      title: 'Strategy Performance Summary',
      data: this.generateStrategyTableData(),
      config: {
        refreshInterval: 30000,
        colorScheme: 'default',
        interactive: true,
        exportable: true,
        filters: [
          {
            field: 'strategyType',
            type: 'SELECT',
            options: ['ALL', 'MOMENTUM', 'MEAN_REVERSION', 'ARBITRAGE', 'MARKET_MAKING'],
            default: 'ALL'
          }
        ]
      },
      lastUpdated: new Date()
    };
    
    this.widgets.set(widget.id, widget);
    this.scheduleWidgetUpdate(widget);
  }
  
  private scheduleWidgetUpdate(widget: DashboardWidget): void {
    if (widget.config.refreshInterval <= 0) return;
    
    const interval = setInterval(async () => {
      await this.updateWidget(widget.id);
    }, widget.config.refreshInterval);
    
    this.updateIntervals.set(widget.id, interval);
  }
  
  private async updateWidget(widgetId: string): Promise<void> {
    const widget = this.widgets.get(widgetId);
    if (!widget) return;
    
    try {
      switch (widget.type) {
        case 'HEATMAP':
          widget.data = this.generateHeatmapData();
          break;
        case 'PIE_CHART':
          widget.data = this.generateAllocationData();
          break;
        case 'ATTRIBUTION':
          widget.data = this.generateAttributionData();
          break;
        case 'TIME_SERIES':
          widget.data = this.generateTimeSeriesData();
          break;
        case 'GAUGE':
          widget.data = this.generateRiskGaugeData();
          break;
        case 'TABLE':
          widget.data = this.generateStrategyTableData();
          break;
      }
      
      widget.lastUpdated = new Date();
      
      this.emit('widget-updated', widget);
      
    } catch (error) {
      this.logger.error('Widget update failed', {
        widgetId,
        error
      });
    }
  }
  
  private generateHeatmapData(): HeatmapData {
    const strategies = ['Momentum', 'Mean Reversion', 'Arbitrage', 'Market Making', 'Fundamental'];
    const hours = Array.from({ length: 24 }, (_, i) => `${i}:00`);
    const values: number[][] = [];
    
    // Generate utilization rates for each strategy over 24 hours
    for (let i = 0; i < strategies.length; i++) {
      values[i] = [];
      for (let j = 0; j < hours.length; j++) {
        // Simulate utilization patterns
        const baseUtilization = 0.5 + Math.random() * 0.3;
        const hourlyVariation = Math.sin((j / 24) * 2 * Math.PI) * 0.2;
        values[i][j] = Math.max(0, Math.min(1, baseUtilization + hourlyVariation));
      }
    }
    
    return {
      rows: strategies,
      columns: hours,
      values,
      metadata: {
        min: 0,
        max: 1,
        mean: 0.65,
        colorScale: 'viridis'
      }
    };
  }
  
  private generateAllocationData(): any {
    const allocations = [
      { name: 'Momentum', value: 35, color: '#1f77b4' },
      { name: 'Mean Reversion', value: 25, color: '#ff7f0e' },
      { name: 'Arbitrage', value: 20, color: '#2ca02c' },
      { name: 'Market Making', value: 15, color: '#d62728' },
      { name: 'Cash Buffer', value: 5, color: '#9467bd' }
    ];
    
    return {
      data: allocations,
      total: 100,
      unit: '%'
    };
  }
  
  private generateAttributionData(): AlphaAttribution[] {
    const strategies = [
      'momentum_alpha', 'reversion_beta', 'arb_gamma', 'mm_delta', 'fundamental_theta'
    ];
    
    return strategies.map(id => ({
      strategyId: id,
      strategyName: id.split('_')[0].toUpperCase(),
      grossAlpha: Math.random() * 0.1 - 0.02,
      netAlpha: Math.random() * 0.08 - 0.01,
      riskAdjustedAlpha: Math.random() * 0.06,
      attribution: {
        timing: Math.random() * 0.03,
        selection: Math.random() * 0.04,
        allocation: Math.random() * 0.02,
        interaction: Math.random() * 0.01
      },
      contribution: Math.random() * 0.3
    }));
  }
  
  private generateTimeSeriesData(): any {
    const now = Date.now();
    const dataPoints: Array<{
      timestamp: Date;
      value: number;
      pnl: number;
      drawdown: number;
      sharpe: number;
    }> = [];
    
    // Generate 30 days of data
    for (let i = 30; i >= 0; i--) {
      const timestamp = new Date(now - i * 24 * 60 * 60 * 1000);
      const value = 100000 + Math.random() * 20000 + i * 500;
      
      dataPoints.push({
        timestamp,
        value,
        pnl: value - 100000,
        drawdown: Math.max(0, Math.random() * 0.1),
        sharpe: 1.5 + Math.random() * 1.0
      });
    }
    
    return {
      series: dataPoints,
      metadata: {
        startValue: 100000,
        endValue: dataPoints[dataPoints.length - 1].value,
        maxValue: Math.max(...dataPoints.map(d => d.value)),
        minValue: Math.min(...dataPoints.map(d => d.value))
      }
    };
  }
  
  private generateRiskGaugeData(): any {
    return {
      gauges: [
        {
          name: 'VaR Utilization',
          value: 0.72,
          max: 1.0,
          thresholds: [0.5, 0.8, 0.95],
          color: this.getGaugeColor(0.72)
        },
        {
          name: 'Leverage',
          value: 1.8,
          max: 3.0,
          thresholds: [1.0, 2.0, 2.5],
          color: this.getGaugeColor(1.8 / 3.0)
        },
        {
          name: 'Concentration Risk',
          value: 0.28,
          max: 0.5,
          thresholds: [0.2, 0.3, 0.4],
          color: this.getGaugeColor(0.28 / 0.5)
        },
        {
          name: 'Drawdown',
          value: 0.08,
          max: 0.20,
          thresholds: [0.05, 0.10, 0.15],
          color: this.getGaugeColor(0.08 / 0.20)
        }
      ]
    };
  }
  
  private getGaugeColor(ratio: number): string {
    if (ratio < 0.5) return '#28a745';
    if (ratio < 0.8) return '#ffc107';
    return '#dc3545';
  }
  
  private generateStrategyTableData(): any {
    const strategies = [
      {
        id: 'mom_001',
        name: 'Momentum Alpha',
        type: 'MOMENTUM',
        capital: 3500000,
        pnl: 125000,
        sharpe: 2.1,
        maxDD: 0.08,
        positions: 15,
        status: 'ACTIVE'
      },
      {
        id: 'rev_001',
        name: 'Mean Reversion Beta',
        type: 'MEAN_REVERSION',
        capital: 2500000,
        pnl: 87000,
        sharpe: 1.8,
        maxDD: 0.12,
        positions: 23,
        status: 'ACTIVE'
      },
      {
        id: 'arb_001',
        name: 'Statistical Arbitrage',
        type: 'ARBITRAGE',
        capital: 2000000,
        pnl: 156000,
        sharpe: 3.2,
        maxDD: 0.05,
        positions: 42,
        status: 'ACTIVE'
      },
      {
        id: 'mm_001',
        name: 'Market Making Delta',
        type: 'MARKET_MAKING',
        capital: 1500000,
        pnl: 98000,
        sharpe: 2.5,
        maxDD: 0.06,
        positions: 156,
        status: 'ACTIVE'
      }
    ];
    
    return {
      columns: [
        { field: 'name', header: 'Strategy', sortable: true },
        { field: 'type', header: 'Type', sortable: true },
        { field: 'capital', header: 'Capital', sortable: true, format: 'currency' },
        { field: 'pnl', header: 'P&L', sortable: true, format: 'currency' },
        { field: 'sharpe', header: 'Sharpe', sortable: true, format: 'number' },
        { field: 'maxDD', header: 'Max DD', sortable: true, format: 'percentage' },
        { field: 'positions', header: 'Positions', sortable: true },
        { field: 'status', header: 'Status', sortable: false }
      ],
      data: strategies,
      summary: {
        totalCapital: strategies.reduce((sum, s) => sum + s.capital, 0),
        totalPnL: strategies.reduce((sum, s) => sum + s.pnl, 0),
        avgSharpe: strategies.reduce((sum, s) => sum + s.sharpe, 0) / strategies.length
      }
    };
  }
  
  private startDataCollection(): void {
    // Collect capital usage data every minute
    setInterval(() => {
      this.collectCapitalUsageData();
    }, 60000);
    
    // Update dashboard metrics every 30 seconds
    setInterval(() => {
      this.updateDashboardMetrics();
    }, 30000);
    
    // Calculate alpha attribution every 5 minutes
    setInterval(() => {
      this.calculateAlphaAttribution();
    }, 300000);
  }
  
  private collectCapitalUsageData(): void {
    const usage: CapitalUsageData = {
      timestamp: new Date(),
      strategies: new Map(),
      totalCapital: 10000000,
      deployedCapital: 9500000,
      cashBuffer: 500000,
      utilizationRate: 0.95
    };
    
    // Add mock strategy data
    const strategies = ['momentum', 'mean_reversion', 'arbitrage', 'market_making'];
    strategies.forEach(strategyType => {
      usage.strategies.set(strategyType, {
        strategyId: `${strategyType}_001`,
        strategyName: strategyType.replace('_', ' ').toUpperCase(),
        strategyType,
        allocatedCapital: 2500000,
        deployedCapital: 2375000,
        utilizationRate: 0.95,
        performance: {
          pnl: Math.random() * 100000 - 20000,
          sharpeRatio: 1 + Math.random() * 2,
          alpha: Math.random() * 0.1,
          beta: 0.5 + Math.random()
        },
        positions: Math.floor(Math.random() * 50) + 10,
        risk: {
          var: Math.random() * 0.05,
          maxDrawdown: Math.random() * 0.15,
          currentDrawdown: Math.random() * 0.05
        }
      });
    });
    
    this.capitalUsageHistory.push(usage);
    
    // Keep last 1440 entries (24 hours at 1-minute intervals)
    if (this.capitalUsageHistory.length > 1440) {
      this.capitalUsageHistory = this.capitalUsageHistory.slice(-1440);
    }
  }
  
  private updateDashboardMetrics(): void {
    // Calculate aggregate metrics
    const latestUsage = this.capitalUsageHistory[this.capitalUsageHistory.length - 1];
    if (!latestUsage) return;
    
    this.dashboardMetrics = {
      totalAUM: latestUsage.totalCapital,
      deployedCapital: latestUsage.deployedCapital,
      cashReserve: latestUsage.cashBuffer,
      totalStrategies: latestUsage.strategies.size,
      activeStrategies: Array.from(latestUsage.strategies.values())
        .filter(s => s.utilizationRate > 0).length,
      overallSharpe: this.calculateOverallSharpe(),
      overallAlpha: this.calculateOverallAlpha(),
      capitalEfficiency: latestUsage.deployedCapital / latestUsage.totalCapital,
      riskBudgetUsed: this.calculateRiskBudgetUsage()
    };
    
    this.emit('metrics-updated', this.dashboardMetrics);
  }
  
  private calculateOverallSharpe(): number {
    // Weighted average Sharpe ratio
    const latestUsage = this.capitalUsageHistory[this.capitalUsageHistory.length - 1];
    if (!latestUsage) return 0;
    
    let weightedSharpe = 0;
    let totalWeight = 0;
    
    for (const strategy of latestUsage.strategies.values()) {
      const weight = strategy.allocatedCapital / latestUsage.totalCapital;
      weightedSharpe += strategy.performance.sharpeRatio * weight;
      totalWeight += weight;
    }
    
    return totalWeight > 0 ? weightedSharpe / totalWeight : 0;
  }
  
  private calculateOverallAlpha(): number {
    // Aggregate alpha across strategies
    const latestUsage = this.capitalUsageHistory[this.capitalUsageHistory.length - 1];
    if (!latestUsage) return 0;
    
    let totalAlpha = 0;
    for (const strategy of latestUsage.strategies.values()) {
      totalAlpha += strategy.performance.alpha * (strategy.allocatedCapital / latestUsage.totalCapital);
    }
    
    return totalAlpha;
  }
  
  private calculateRiskBudgetUsage(): number {
    // Calculate how much of risk budget is being used
    const latestUsage = this.capitalUsageHistory[this.capitalUsageHistory.length - 1];
    if (!latestUsage) return 0;
    
    let maxVar = 0;
    for (const strategy of latestUsage.strategies.values()) {
      maxVar = Math.max(maxVar, strategy.risk.var);
    }
    
    return maxVar / 0.05; // Assuming 5% VaR limit
  }
  
  private calculateAlphaAttribution(): void {
    // Calculate detailed alpha attribution for each strategy
    const latestUsage = this.capitalUsageHistory[this.capitalUsageHistory.length - 1];
    if (!latestUsage) return;
    
    for (const [strategyId, strategy] of latestUsage.strategies) {
      const attribution: AlphaAttribution = {
        strategyId,
        strategyName: strategy.strategyName,
        grossAlpha: strategy.performance.alpha,
        netAlpha: strategy.performance.alpha * 0.8, // After costs
        riskAdjustedAlpha: strategy.performance.alpha / Math.sqrt(strategy.risk.var),
        attribution: {
          timing: strategy.performance.alpha * 0.3,
          selection: strategy.performance.alpha * 0.4,
          allocation: strategy.performance.alpha * 0.2,
          interaction: strategy.performance.alpha * 0.1
        },
        contribution: (strategy.allocatedCapital / latestUsage.totalCapital) * strategy.performance.alpha
      };
      
      this.alphaAttributions.set(strategyId, attribution);
    }
  }
  
  public getWidget(widgetId: string): DashboardWidget | undefined {
    return this.widgets.get(widgetId);
  }
  
  public getAllWidgets(): DashboardWidget[] {
    return Array.from(this.widgets.values());
  }
  
  public getDashboardMetrics(): DashboardMetrics {
    return { ...this.dashboardMetrics };
  }
  
  public getCapitalUsageHistory(hours: number = 24): CapitalUsageData[] {
    const cutoff = Date.now() - hours * 60 * 60 * 1000;
    return this.capitalUsageHistory.filter(d => d.timestamp.getTime() > cutoff);
  }
  
  public exportDashboardData(format: 'JSON' | 'CSV' = 'JSON'): string {
    const exportData = {
      metrics: this.dashboardMetrics,
      widgets: Array.from(this.widgets.entries()).map(([id, widget]) => ({
        id,
        title: widget.title,
        type: widget.type,
        lastUpdated: widget.lastUpdated
      })),
      capitalUsage: this.capitalUsageHistory.slice(-60), // Last hour
      alphaAttributions: Array.from(this.alphaAttributions.values()),
      exportTime: new Date()
    };
    
    if (format === 'JSON') {
      return JSON.stringify(exportData, null, 2);
    } else {
      // CSV format for strategy summary
      const strategies = Array.from(this.alphaAttributions.values());
      const headers = ['Strategy', 'Gross Alpha', 'Net Alpha', 'Risk-Adjusted Alpha', 'Contribution'];
      const rows = strategies.map(s => [
        s.strategyName,
        s.grossAlpha.toFixed(4),
        s.netAlpha.toFixed(4),
        s.riskAdjustedAlpha.toFixed(4),
        s.contribution.toFixed(4)
      ]);
      
      return [headers, ...rows].map(row => row.join(',')).join('\n');
    }
  }
  
  public destroy(): void {
    // Clear all update intervals
    for (const interval of this.updateIntervals.values()) {
      clearInterval(interval);
    }
    
    this.updateIntervals.clear();
    this.logger.info('Capital strategy dashboard destroyed');
  }
} 