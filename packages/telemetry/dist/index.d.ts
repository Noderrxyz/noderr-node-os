/**
 * @noderr/telemetry - Unified telemetry system
 */
export declare class TelemetrySystem {
    private logger;
    private serviceName;
    private environment;
    constructor(config: {
        serviceName: string;
        environment: string;
        exporters?: string[];
    });
    getMetrics(): MetricsCollector;
    getTracer(): Tracer;
}
export declare class MetricsCollector {
    private serviceName;
    private counters;
    private histograms;
    private gauges;
    constructor(serviceName: string);
    counter(name: string): Counter;
    histogram(name: string): Histogram;
    gauge(name: string): Gauge;
}
export declare class Counter {
    private name;
    private value;
    constructor(name: string);
    increment(value?: number): void;
    getValue(): number;
    reset(): void;
}
export declare class Histogram {
    private name;
    private values;
    constructor(name: string);
    record(value: number): void;
    getValues(): number[];
    reset(): void;
}
export declare class Gauge {
    private name;
    private value;
    constructor(name: string);
    set(value: number): void;
    getValue(): number;
    increment(value?: number): void;
    decrement(value?: number): void;
}
export declare class Tracer {
    private serviceName;
    constructor(serviceName: string);
    startSpan(name: string): Span;
}
export declare class Span {
    private name;
    private serviceName;
    private startTime;
    private endTime?;
    private attributes;
    constructor(name: string, serviceName: string);
    setAttribute(key: string, value: any): void;
    end(): void;
    getDuration(): number | undefined;
}
export declare class AlertManager {
    private alerts;
    private logger;
    constructor();
    createAlert(config: AlertConfig): Alert;
    getAlerts(): Alert[];
}
export interface AlertConfig {
    name: string;
    condition: string;
    severity: 'info' | 'warning' | 'error' | 'critical';
    channels: string[];
}
export declare class Alert {
    private config;
    constructor(config: AlertConfig);
    getName(): string;
    getSeverity(): string;
    getChannels(): string[];
}
export declare class Dashboard {
    private config;
    private panels;
    constructor(config: {
        title: string;
        refresh?: string;
    });
    addPanel(config: PanelConfig): void;
    getPanels(): Panel[];
}
export interface PanelConfig {
    title: string;
    metric: string;
    visualization: 'timeseries' | 'gauge' | 'counter' | 'table';
}
export declare class Panel {
    private config;
    constructor(config: PanelConfig);
    getTitle(): string;
    getMetric(): string;
    getVisualization(): string;
}
//# sourceMappingURL=index.d.ts.map