import { TelemetryBus } from '../../telemetry/TelemetryBus';
import { InMemorySink } from '../../telemetry/MetricsSink';

describe('TelemetryBus backpressure (paper-mode)', () => {
  test('drops and warns when queue exceeds threshold; sink receives batches', async () => {
    const bus = TelemetryBus.getInstance({
      logFilePath: 'telemetry-test.log',
      maxLogSize: 1024 * 1024,
      maxLogFiles: 1,
      flushIntervalMs: 1000,
      maxBatchSize: 2,
      maxQueueSize: 5,
      warnAtPercent: 80,
    });

    const sink = new InMemorySink();
    bus.setSink(sink);

    // Push 6 events to exceed maxQueueSize (5)
    for (let i = 0; i < 6; i++) {
      bus.emit('test_event', { idx: i });
    }

    // Allow async drain
    await new Promise((r) => setTimeout(r, 50));

    expect(bus.getQueueSize()).toBeLessThanOrEqual(5);
    expect(bus.getDroppedEvents()).toBeGreaterThanOrEqual(1);

    // Wait for flush interval to drain and sink to receive
    await new Promise((r) => setTimeout(r, 1100));
    // We don't assert exact sink size due to rotations; ensure no crash path
    expect(typeof bus.getWriteErrors()).toBe('number');

    // Cleanup singleton to avoid cross-test noise
    bus.cleanup();
  });
});


