/**
 * @noderr/telemetry - Unified telemetry system
 */

import { Logger, createLogger, format, transports } from 'winston';

// Core telemetry system
export class TelemetrySystem {
  private logger: Logger;
  private serviceName: string;
  private environment: string;

  constructor(config: {
    serviceName: string;
    environment: string;
    exporters?: string[];
  }) {
    this.serviceName = config.serviceName;
    this.environment = config.environment;
    this.logger = createLogger({
      format: format.combine(format.timestamp(), format.json()),
      defaultMeta: { service: `telemetry:${config.serviceName}` },
      transports: [new transports.Console()]
    });
    
    this.logger.info('TelemetrySystem initialized', {
      serviceName: config.serviceName,
      environment: config.environment,
      exporters: config.exporters
    });
  }

  getMetrics(): MetricsCollector {
    return new MetricsCollector(this.serviceName);
  }

  getTracer(): Tracer {
    return new Tracer(this.serviceName);
  }
}

// Metrics collector
export class MetricsCollector {
  private counters: Map<string, Counter> = new Map();
  private histograms: Map<string, Histogram> = new Map();
  private gauges: Map<string, Gauge> = new Map();

  constructor(private serviceName: string) {}

  counter(name: string): Counter {
    if (!this.counters.has(name)) {
      this.counters.set(name, new Counter(name));
    }
    return this.counters.get(name)!;
  }

  histogram(name: string): Histogram {
    if (!this.histograms.has(name)) {
      this.histograms.set(name, new Histogram(name));
    }
    return this.histograms.get(name)!;
  }

  gauge(name: string): Gauge {
    if (!this.gauges.has(name)) {
      this.gauges.set(name, new Gauge(name));
    }
    return this.gauges.get(name)!;
  }
}

// Counter metric
export class Counter {
  private value: number = 0;

  constructor(private name: string) {}

  increment(value: number = 1): void {
    this.value += value;
  }

  getValue(): number {
    return this.value;
  }

  reset(): void {
    this.value = 0;
  }
}

// Histogram metric
export class Histogram {
  private values: number[] = [];

  constructor(private name: string) {}

  record(value: number): void {
    this.values.push(value);
  }

  getValues(): number[] {
    return [...this.values];
  }

  reset(): void {
    this.values = [];
  }
}

// Gauge metric
export class Gauge {
  private value: number = 0;

  constructor(private name: string) {}

  set(value: number): void {
    this.value = value;
  }

  getValue(): number {
    return this.value;
  }

  increment(value: number = 1): void {
    this.value += value;
  }

  decrement(value: number = 1): void {
    this.value -= value;
  }
}

// Tracer for distributed tracing
export class Tracer {
  constructor(private serviceName: string) {}

  startSpan(name: string): Span {
    return new Span(name, this.serviceName);
  }
}

// Span for tracing
export class Span {
  private startTime: number;
  private endTime?: number;
  private attributes: Record<string, any> = {};

  constructor(
    private name: string,
    private serviceName: string
  ) {
    this.startTime = Date.now();
  }

  setAttribute(key: string, value: any): void {
    this.attributes[key] = value;
  }

  end(): void {
    this.endTime = Date.now();
  }

  getDuration(): number | undefined {
    if (!this.endTime) return undefined;
    return this.endTime - this.startTime;
  }
}

// Alert manager
export class AlertManager {
  private alerts: Alert[] = [];
  private logger: Logger;

  constructor() {
    this.logger = createLogger({
      format: format.combine(format.timestamp(), format.json()),
      defaultMeta: { service: 'AlertManager' },
      transports: [new transports.Console()]
    });
  }

  createAlert(config: AlertConfig): Alert {
    const alert = new Alert(config);
    this.alerts.push(alert);
    this.logger.info('Alert created', { name: config.name });
    return alert;
  }

  getAlerts(): Alert[] {
    return [...this.alerts];
  }
}

// Alert configuration
export interface AlertConfig {
  name: string;
  condition: string;
  severity: 'info' | 'warning' | 'error' | 'critical';
  channels: string[];
}

// Alert
export class Alert {
  constructor(private config: AlertConfig) {}

  getName(): string {
    return this.config.name;
  }

  getSeverity(): string {
    return this.config.severity;
  }

  getChannels(): string[] {
    return [...this.config.channels];
  }
}

// Dashboard
export class Dashboard {
  private panels: Panel[] = [];

  constructor(private config: {
    title: string;
    refresh?: string;
  }) {}

  addPanel(config: PanelConfig): void {
    this.panels.push(new Panel(config));
  }

  getPanels(): Panel[] {
    return [...this.panels];
  }
}

// Panel configuration
export interface PanelConfig {
  title: string;
  metric: string;
  visualization: 'timeseries' | 'gauge' | 'counter' | 'table';
}

// Panel
export class Panel {
  constructor(private config: PanelConfig) {}

  getTitle(): string {
    return this.config.title;
  }

  getMetric(): string {
    return this.config.metric;
  }

  getVisualization(): string {
    return this.config.visualization;
  }
} 