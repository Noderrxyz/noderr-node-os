import { VenueLatencyTrackerRust } from '@noderr/execution/src/VenueLatencyTrackerRust';

// Mock the NapiVenueLatencyTracker
jest.mock('@noderr/core', () => {
  const originalModule = jest.requireActual('@noderr/core');
  
  // Create a mock map to store latency data
  const latencyMap = new Map<string, number[]>();
  
  return {
    ...originalModule,
    NapiVenueLatencyTracker: jest.fn().mockImplementation(() => ({
      record_latency: jest.fn((venue: string, duration_ns: number) => {
        if (!latencyMap.has(venue)) {
          latencyMap.set(venue, []);
        }
        latencyMap.get(venue)?.push(duration_ns);
      }),
      
      get_latency_stats: jest.fn((venue: string) => {
        const data = latencyMap.get(venue);
        if (!data || data.length === 0) return null;
        
        // Calculate basic statistics
        const sum = data.reduce((a, b) => a + b, 0);
        const avg = sum / data.length;
        const sorted = [...data].sort((a, b) => a - b);
        const min = sorted[0];
        const max = sorted[sorted.length - 1];
        
        // Calculate percentiles
        const p50Idx = Math.floor(sorted.length * 0.5);
        const p90Idx = Math.floor(sorted.length * 0.9);
        const p95Idx = Math.floor(sorted.length * 0.95);
        const p99Idx = Math.floor(sorted.length * 0.99);
        
        return {
          avg_ns: avg,
          p50_ns: sorted[p50Idx] || avg,
          p90_ns: sorted[p90Idx] || avg,
          p95_ns: sorted[p95Idx] || avg,
          p99_ns: sorted[p99Idx] || avg,
          min_ns: min,
          max_ns: max,
          recent_avg_ns: avg, // Simplified for testing
          sample_count: data.length,
        };
      }),
      
      get_avg_latency: jest.fn((venue: string) => {
        const data = latencyMap.get(venue);
        if (!data || data.length === 0) return null;
        return data.reduce((a, b) => a + b, 0) / data.length;
      }),
      
      get_p99_latency: jest.fn((venue: string) => {
        const data = latencyMap.get(venue);
        if (!data || data.length === 0) return null;
        const sorted = [...data].sort((a, b) => a - b);
        const idx = Math.floor(sorted.length * 0.99);
        return sorted[idx] || sorted[sorted.length - 1];
      }),
      
      get_recent_avg_latency: jest.fn((venue: string) => {
        const data = latencyMap.get(venue);
        if (!data || data.length === 0) return null;
        return data.reduce((a, b) => a + b, 0) / data.length;
      }),
      
      reset: jest.fn((venue: string) => {
        latencyMap.delete(venue);
      }),
      
      reset_all: jest.fn(() => {
        latencyMap.clear();
      }),
      
      get_tracked_venues: jest.fn(() => {
        return Array.from(latencyMap.keys());
      }),
    })),
  };
});

describe('VenueLatencyTrackerRust', () => {
  let tracker: VenueLatencyTrackerRust;
  
  beforeEach(() => {
    // Reset the singleton instance before each test
    (VenueLatencyTrackerRust as any).instance = null;
    tracker = VenueLatencyTrackerRust.getInstance();
  });
  
  describe('singleton pattern', () => {
    it('should return the same instance when getInstance is called multiple times', () => {
      const instance1 = VenueLatencyTrackerRust.getInstance();
      const instance2 = VenueLatencyTrackerRust.getInstance();
      
      expect(instance1).toBe(instance2);
    });
  });
  
  describe('record and retrieve latency', () => {
    it('should record latency measurements and return average latency', () => {
      tracker.record('binance', 5);
      tracker.record('binance', 7);
      tracker.record('binance', 6);
      
      const avgLatency = tracker.getAvgLatency('binance');
      expect(avgLatency).toBeCloseTo(6, 1);
    });
    
    it('should return -1 for average latency when no data exists', () => {
      const avgLatency = tracker.getAvgLatency('unknown-venue');
      expect(avgLatency).toBe(-1);
    });
    
    it('should handle timing functions', () => {
      // Mock implementation for timing
      const startTime = tracker.startTiming();
      jest.advanceTimersByTime(10);
      tracker.finishTiming('kraken', startTime);
      
      // Ensure a latency was recorded
      expect(tracker.getTrackedVenues()).toContain('kraken');
    });
  });
  
  describe('latency statistics', () => {
    beforeEach(() => {
      // Fill tracker with sample data
      for (let i = 1; i <= 100; i++) {
        tracker.record('binance', i);
      }
    });
    
    it('should return comprehensive statistics', () => {
      const stats = tracker.getStats('binance');
      
      expect(stats).not.toBeNull();
      if (stats) {
        expect(stats.avgMs).toBeGreaterThan(0);
        expect(stats.p50Ms).toBeCloseTo(50.5, 0);
        expect(stats.p90Ms).toBeCloseTo(90.5, 0);
        expect(stats.p95Ms).toBeCloseTo(95.5, 0);
        expect(stats.p99Ms).toBeCloseTo(99.5, 0);
        expect(stats.minMs).toBeCloseTo(1, 0);
        expect(stats.maxMs).toBeCloseTo(100, 0);
        expect(stats.sampleCount).toBe(100);
      }
    });
    
    it('should return null stats for unknown venues', () => {
      const stats = tracker.getStats('unknown-venue');
      expect(stats).toBeNull();
    });
    
    it('should return p99 latency', () => {
      const p99 = tracker.getP99Latency('binance');
      expect(p99).toBeCloseTo(99.5, 0);
    });
    
    it('should return recent average latency', () => {
      const recentAvg = tracker.getRecentAvgLatency('binance');
      expect(recentAvg).toBeGreaterThan(0);
    });
  });
  
  describe('reset functionality', () => {
    beforeEach(() => {
      tracker.record('binance', 5);
      tracker.record('kraken', 10);
    });
    
    it('should reset latency for a specific venue', () => {
      tracker.reset('binance');
      
      expect(tracker.getAvgLatency('binance')).toBe(-1);
      expect(tracker.getAvgLatency('kraken')).toBe(10);
    });
    
    it('should reset all latency history', () => {
      tracker.resetAll();
      
      expect(tracker.getAvgLatency('binance')).toBe(-1);
      expect(tracker.getAvgLatency('kraken')).toBe(-1);
      expect(tracker.getTrackedVenues()).toHaveLength(0);
    });
  });
  
  describe('venue tracking', () => {
    it('should return all tracked venues', () => {
      tracker.record('binance', 5);
      tracker.record('kraken', 10);
      tracker.record('coinbase', 7);
      
      const venues = tracker.getTrackedVenues();
      expect(venues).toHaveLength(3);
      expect(venues).toContain('binance');
      expect(venues).toContain('kraken');
      expect(venues).toContain('coinbase');
    });
  });
  
  describe('routing score calculation', () => {
    beforeEach(() => {
      // Fill tracker with different latency profiles
      for (let i = 1; i <= 10; i++) {
        tracker.record('low-latency', i * 2); // 2-20ms
        tracker.record('high-latency', i * 10); // 10-100ms
        tracker.record('spiky-latency', i === 10 ? 500 : i * 5); // 5-45ms with one 500ms spike
      }
    });
    
    it('should calculate a routing score where lower latency has better score', () => {
      const lowLatencyScore = tracker.getRoutingScore('low-latency');
      const highLatencyScore = tracker.getRoutingScore('high-latency');
      
      expect(lowLatencyScore).toBeLessThan(highLatencyScore);
    });
    
    it('should penalize venues with latency spikes in p99', () => {
      const normalScore = tracker.getRoutingScore('low-latency');
      const spikyScore = tracker.getRoutingScore('spiky-latency');
      
      expect(spikyScore).toBeGreaterThan(normalScore);
    });
    
    it('should return worst score (100) for venues with insufficient data', () => {
      const score = tracker.getRoutingScore('unknown-venue');
      expect(score).toBe(100);
    });
  });
}); 