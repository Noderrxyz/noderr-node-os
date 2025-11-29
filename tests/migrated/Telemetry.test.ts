import { telemetry, SeverityLevel, TraceFunctions } from '../index';
import { ConsoleExporter } from '../exporters/ConsoleExporter';
import { JsonExporter } from '../exporters/JsonExporter';
import { EventExporter } from '../exporters/EventExporter';

describe('Telemetry System', () => {
  // Mock console.log to prevent test output pollution
  const originalConsoleLog = console.log;
  const originalConsoleError = console.error;
  const originalConsoleWarn = console.warn;
  const originalConsoleDebug = console.debug;
  
  // Create mock exporters
  class MockExporter {
    exportedMetrics: any[] = [];
    exportedErrors: any[] = [];
    exportedEvents: any[] = [];
    failNextExport: boolean = false;
    
    reset() {
      this.exportedMetrics = [];
      this.exportedErrors = [];
      this.exportedEvents = [];
      this.failNextExport = false;
    }
    
    exportMetric(metric: any) {
      if (this.failNextExport) {
        throw new Error('Intentional mock exporter failure');
      }
      this.exportedMetrics.push(metric);
    }
    
    exportMetrics(metrics: any[]) {
      if (this.failNextExport) {
        throw new Error('Intentional mock exporter failure');
      }
      this.exportedMetrics.push(...metrics);
    }
    
    exportError(error: any) {
      if (this.failNextExport) {
        throw new Error('Intentional mock exporter failure');
      }
      this.exportedErrors.push(error);
    }
    
    exportErrors(errors: any[]) {
      if (this.failNextExport) {
        throw new Error('Intentional mock exporter failure');
      }
      this.exportedErrors.push(...errors);
    }
    
    exportEvent(event: any) {
      if (this.failNextExport) {
        throw new Error('Intentional mock exporter failure');
      }
      this.exportedEvents.push(event);
    }
  }
  
  let mockExporter: MockExporter;
  
  beforeAll(() => {
    // Silence console output during tests
    console.log = jest.fn();
    console.error = jest.fn();
    console.warn = jest.fn();
    console.debug = jest.fn();
  });
  
  afterAll(() => {
    // Restore console functions
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
    console.warn = originalConsoleWarn;
    console.debug = originalConsoleDebug;
  });
  
  beforeEach(() => {
    // Reset telemetry state
    telemetry.clearMetrics();
    telemetry.clearErrors();
    telemetry.clearEvents();
    
    // Create and register mock exporter
    mockExporter = new MockExporter();
    telemetry.registerExporter(mockExporter as any);
    
    // Configure immediate export for easier testing
    telemetry.updateConfig({
      enabled: true,
      immediateMetricExport: true,
      immediateErrorExport: true,
      samplingRate: 1.0 // Record everything for tests
    });
  });
  
  test('should record and export metrics', () => {
    // Record a metric
    telemetry.recordMetric('test_metric', 42, { tag1: 'value1' });
    
    // Check if metric was exported
    expect(mockExporter.exportedMetrics.length).toBe(1);
    expect(mockExporter.exportedMetrics[0].name).toBe('test_metric');
    expect(mockExporter.exportedMetrics[0].value).toBe(42);
    expect(mockExporter.exportedMetrics[0].tags).toEqual({ tag1: 'value1' });
  });
  
  test('should record and export errors', () => {
    // Record an error
    const testError = new Error('Test error');
    telemetry.recordError('TestComponent', testError, SeverityLevel.ERROR, { tag1: 'value1' });
    
    // Check if error was exported
    expect(mockExporter.exportedErrors.length).toBe(1);
    expect(mockExporter.exportedErrors[0].component).toBe('TestComponent');
    expect(mockExporter.exportedErrors[0].message).toBe('Test error');
    expect(mockExporter.exportedErrors[0].severity).toBe(SeverityLevel.ERROR);
    expect(mockExporter.exportedErrors[0].tags).toEqual({ tag1: 'value1' });
  });
  
  test('should record and export events', () => {
    // Record an event
    telemetry.recordEvent('test_event', 'TestComponent', { tag1: 'value1' });
    
    // Check if event was exported (if exporter supports events)
    expect(mockExporter.exportedEvents.length).toBe(1);
    expect(mockExporter.exportedEvents[0].name).toBe('test_event');
    expect(mockExporter.exportedEvents[0].component).toBe('TestComponent');
    expect(mockExporter.exportedEvents[0].tags).toEqual({ tag1: 'value1' });
  });
  
  test('should handle exporter failures gracefully', () => {
    // Make the exporter fail
    mockExporter.failNextExport = true;
    
    // This should not throw
    expect(() => {
      telemetry.recordMetric('test_metric', 42);
    }).not.toThrow();
    
    // This should not throw
    expect(() => {
      telemetry.recordError('TestComponent', new Error('Test error'));
    }).not.toThrow();
  });
  
  test('should apply sampling correctly', () => {
    // Configure sampling
    telemetry.updateConfig({
      samplingRate: 0, // Record nothing
      alwaysSampledMetrics: ['important_metric']
    });
    
    // Reset exported metrics
    mockExporter.reset();
    
    // Record metrics
    telemetry.recordMetric('sampled_metric', 42);
    telemetry.recordMetric('important_metric', 43);
    
    // Only important metric should be exported
    expect(mockExporter.exportedMetrics.length).toBe(1);
    expect(mockExporter.exportedMetrics[0].name).toBe('important_metric');
  });
  
  test('should trace async functions correctly', async () => {
    // Test async function tracing
    const result = await TraceFunctions.traceAsync(
      'TestComponent',
      'testMethod',
      async () => {
        // Simulate work
        await new Promise(resolve => setTimeout(resolve, 10));
        return 'result';
      }
    );
    
    // Check result
    expect(result).toBe('result');
    
    // Check metrics recorded
    const metrics = mockExporter.exportedMetrics;
    const durationMetrics = metrics.filter(m => m.name.includes('duration_ms'));
    const successMetrics = metrics.filter(m => m.name.includes('success_count'));
    
    expect(durationMetrics.length).toBeGreaterThan(0);
    expect(successMetrics.length).toBeGreaterThan(0);
    
    // The duration should be positive
    expect(durationMetrics[0].value).toBeGreaterThan(0);
  });
  
  test('should trace and record errors in async functions', async () => {
    // Test error handling in traced functions
    try {
      await TraceFunctions.traceAsync(
        'TestComponent',
        'testErrorMethod',
        async () => {
          throw new Error('Test trace error');
        }
      );
      fail('Should have thrown');
    } catch (error) {
      expect((error as Error).message).toBe('Test trace error');
    }
    
    // Check metrics and errors recorded
    const errorMetrics = mockExporter.exportedMetrics.filter(m => m.name.includes('error_count'));
    expect(errorMetrics.length).toBeGreaterThan(0);
    
    // Should have recorded an error
    expect(mockExporter.exportedErrors.length).toBeGreaterThan(0);
    expect(mockExporter.exportedErrors[0].message).toBe('Test trace error');
  });
  
  test('should provide aggregated metrics', () => {
    // Record multiple values for the same metric
    telemetry.recordMetric('aggregated_metric', 10);
    telemetry.recordMetric('aggregated_metric', 20);
    telemetry.recordMetric('aggregated_metric', 30);
    
    // Get current metrics
    const currentValues = telemetry.getMetrics();
    expect(currentValues['aggregated_metric']).toBe(30); // Last value
    
    // Get aggregated metrics
    const aggregated = telemetry.getAggregatedMetrics();
    expect(aggregated['aggregated_metric']).toBeDefined();
    expect(aggregated['aggregated_metric'].avg).toBe(20);
    expect(aggregated['aggregated_metric'].min).toBe(10);
    expect(aggregated['aggregated_metric'].max).toBe(30);
    expect(aggregated['aggregated_metric'].count).toBe(3);
  });
  
  test('should respect rate limiting of metrics', () => {
    // Configure rate limiting
    telemetry.updateConfig({
      metricRateLimit: 2,
      metricRateLimitPerSecond: {
        'limited_metric': 1
      },
      rateLimitWindowMs: 1000
    });
    
    // Reset exported metrics
    mockExporter.reset();
    
    // Record metrics
    telemetry.recordMetric('limited_metric', 1);
    telemetry.recordMetric('limited_metric', 2); // Should be rate limited
    
    telemetry.recordMetric('normal_metric', 1);
    telemetry.recordMetric('normal_metric', 2);
    telemetry.recordMetric('normal_metric', 3); // Should be rate limited
    
    // Check exports
    const limitedMetrics = mockExporter.exportedMetrics.filter(m => m.name === 'limited_metric');
    const normalMetrics = mockExporter.exportedMetrics.filter(m => m.name === 'normal_metric');
    
    expect(limitedMetrics.length).toBe(1);
    expect(normalMetrics.length).toBe(2);
  });
});

describe('Telemetry Exporters', () => {
  test('ConsoleExporter should initialize correctly', () => {
    const exporter = new ConsoleExporter({
      detailedMetrics: true,
      minErrorSeverity: SeverityLevel.WARNING
    });
    
    expect(exporter).toBeDefined();
  });
  
  test('JsonExporter should initialize correctly', () => {
    const exporter = new JsonExporter({
      outputDir: './test_logs',
      rotateDaily: false
    });
    
    expect(exporter).toBeDefined();
  });
  
  test('EventExporter should initialize correctly', () => {
    let eventReceived = false;
    
    const exporter = new EventExporter({
      convertErrorsToEvents: true,
      eventListener: (event) => {
        eventReceived = true;
      }
    });
    
    expect(exporter).toBeDefined();
    
    // Test event emission
    exporter.exportEvent({
      name: 'test_event',
      component: 'TestComponent',
      timestamp: Date.now(),
      tags: {}
    });
    
    expect(eventReceived).toBe(true);
  });
}); 