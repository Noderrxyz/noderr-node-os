import { EventEmitter } from 'events';
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
export declare class CapitalStrategyDashboard extends EventEmitter {
    private logger;
    private widgets;
    private capitalUsageHistory;
    private alphaAttributions;
    private dashboardMetrics;
    private updateIntervals;
    private dataProviders;
    constructor();
    private initializeDashboard;
    private createCapitalHeatmap;
    private createAllocationPieChart;
    private createAlphaAttributionChart;
    private createPerformanceTimeSeries;
    private createRiskGauges;
    private createStrategyTable;
    private scheduleWidgetUpdate;
    private updateWidget;
    private generateHeatmapData;
    private generateAllocationData;
    private generateAttributionData;
    private generateTimeSeriesData;
    private generateRiskGaugeData;
    private getGaugeColor;
    private generateStrategyTableData;
    private startDataCollection;
    private collectCapitalUsageData;
    private updateDashboardMetrics;
    private calculateOverallSharpe;
    private calculateOverallAlpha;
    private calculateRiskBudgetUsage;
    private calculateAlphaAttribution;
    getWidget(widgetId: string): DashboardWidget | undefined;
    getAllWidgets(): DashboardWidget[];
    getDashboardMetrics(): DashboardMetrics;
    getCapitalUsageHistory(hours?: number): CapitalUsageData[];
    exportDashboardData(format?: 'JSON' | 'CSV'): string;
    destroy(): void;
}
export {};
