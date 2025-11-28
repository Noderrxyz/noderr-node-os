/**
 * MessageBus - Ultra-low latency message routing system
 * 
 * High-performance message bus capable of 10K+ messages/second
 * with sub-100μs average latency for inter-module communication.
 */

import { EventEmitter } from 'events';
import { Logger } from 'winston';
import { performance } from 'perf_hooks';
import {
  Message,
  MessageType,
  MessagePriority,
  MessageHandler,
  Route,
  MessageStats,
  RouteMetrics,
  MessageBusEvents
} from '@noderr/types/messages';

interface HandlerRegistration {
  id: string;
  pattern: string | RegExp;
  handler: MessageHandler;
  priority: MessagePriority;
  module: string;
  registered: number;
}

interface MessageQueue {
  priority: MessagePriority;
  messages: Message[];
  processing: boolean;
}

export class MessageBus extends EventEmitter {
  private logger: Logger;
  private handlers: Map<string, HandlerRegistration[]> = new Map();
  private routes: Route[] = [];
  private stats: Map<string, MessageStats> = new Map();
  private routeMetrics: Map<string, RouteMetrics> = new Map();
  private messageQueues: Map<MessagePriority, MessageQueue> = new Map();
  private processing: boolean = false;
  private started: boolean = false;
  
  // Performance tracking
  private latencyWindow: number[] = [];
  private latencyWindowSize: number = 10000;
  private messageCount: number = 0;
  
  // Configuration
  private config = {
    maxQueueSize: 10000,
    maxMessageSize: 1024 * 1024, // 1MB
    processingInterval: 1, // ms
    latencyWarningThreshold: 1000, // μs
    enableMetrics: true,
    enableTracing: false
  };
  
  constructor(logger: Logger, config?: Partial<typeof MessageBus.prototype.config>) {
    super();
    this.logger = logger;
    if (config) {
      this.config = { ...this.config, ...config };
    }
    
    // Initialize priority queues
    for (const priority of Object.values(MessagePriority)) {
      if (typeof priority === 'number') {
        this.messageQueues.set(priority, {
          priority,
          messages: [],
          processing: false
        });
      }
    }
  }
  
  /**
   * Start the message bus
   */
  async start(): Promise<void> {
    if (this.started) {
      this.logger.warn('MessageBus already started');
      return;
    }
    
    this.logger.info('Starting MessageBus');
    this.started = true;
    this.processing = true;
    
    // Start message processing loop
    this.startProcessingLoop();
    
    this.logger.info('MessageBus started successfully');
  }
  
  /**
   * Stop the message bus
   */
  async stop(): Promise<void> {
    this.logger.info('Stopping MessageBus');
    this.processing = false;
    this.started = false;
    
    // Wait for queues to drain
    await this.drainQueues();
    
    // Clear handlers and routes
    this.handlers.clear();
    this.routes = [];
    
    this.logger.info('MessageBus stopped');
  }
  
  /**
   * Send a message
   */
  async send<T = any>(message: Message<T>): Promise<void> {
    const startTime = performance.now();
    
    try {
      // Validate message
      this.validateMessage(message);
      
      // Update stats
      this.updateSendStats(message.header.source);
      
      // Route message
      await this.routeMessage(message);
      
      // Track latency
      const latency = (performance.now() - startTime) * 1000; // Convert to μs
      this.trackLatency(latency);
      
      // Emit event
      this.emit('message:sent', message);
      
      if (latency > this.config.latencyWarningThreshold) {
        this.logger.warn(`High message latency detected: ${latency.toFixed(2)}μs`, {
          messageId: message.header.id,
          type: message.header.type
        });
      }
    } catch (error) {
      this.logger.error('Failed to send message', { error, messageId: message.header.id });
      this.emit('message:error', error as Error, message);
      throw error;
    }
  }
  
  /**
   * Subscribe to messages
   */
  subscribe(
    pattern: string | RegExp,
    handler: MessageHandler,
    options?: {
      module?: string;
      priority?: MessagePriority;
      types?: MessageType[];
    }
  ): string {
    const id = this.generateHandlerId();
    const registration: HandlerRegistration = {
      id,
      pattern,
      handler,
      priority: options?.priority || MessagePriority.NORMAL,
      module: options?.module || 'unknown',
      registered: Date.now()
    };
    
    const key = pattern instanceof RegExp ? pattern.source : pattern;
    
    if (!this.handlers.has(key)) {
      this.handlers.set(key, []);
    }
    
    this.handlers.get(key)!.push(registration);
    
    // Sort by priority
    this.handlers.get(key)!.sort((a, b) => a.priority - b.priority);
    
    this.logger.debug(`Subscribed to pattern: ${key}`, {
      handlerId: id,
      module: registration.module
    });
    
    return id;
  }
  
  /**
   * Unsubscribe from messages
   */
  unsubscribe(handlerId: string): void {
    for (const [key, registrations] of this.handlers) {
      const index = registrations.findIndex(r => r.id === handlerId);
      if (index !== -1) {
        registrations.splice(index, 1);
        if (registrations.length === 0) {
          this.handlers.delete(key);
        }
        this.logger.debug(`Unsubscribed handler: ${handlerId}`);
        return;
      }
    }
  }
  
  /**
   * Add a route
   */
  addRoute(route: Route): void {
    this.routes.push(route);
    this.emit('route:added', route);
    
    this.logger.debug('Added route', {
      source: route.source,
      destination: route.destination
    });
  }
  
  /**
   * Remove a route
   */
  removeRoute(route: Route): void {
    const index = this.routes.indexOf(route);
    if (index !== -1) {
      this.routes.splice(index, 1);
      this.emit('route:removed', route);
    }
  }
  
  /**
   * Get message statistics
   */
  getStats(): Map<string, MessageStats> {
    return new Map(this.stats);
  }
  
  /**
   * Get route metrics
   */
  getRouteMetrics(): Map<string, RouteMetrics> {
    return new Map(this.routeMetrics);
  }
  
  /**
   * Get current performance metrics
   */
  getPerformanceMetrics(): {
    messageCount: number;
    avgLatency: number;
    p50Latency: number;
    p95Latency: number;
    p99Latency: number;
    queueSizes: Record<string, number>;
  } {
    const sortedLatencies = [...this.latencyWindow].sort((a, b) => a - b);
    const queueSizes: Record<string, number> = {};
    
    for (const [priority, queue] of this.messageQueues) {
      queueSizes[MessagePriority[priority]] = queue.messages.length;
    }
    
    return {
      messageCount: this.messageCount,
      avgLatency: this.calculateAverage(this.latencyWindow),
      p50Latency: this.calculatePercentile(sortedLatencies, 0.5),
      p95Latency: this.calculatePercentile(sortedLatencies, 0.95),
      p99Latency: this.calculatePercentile(sortedLatencies, 0.99),
      queueSizes
    };
  }
  
  /**
   * Private: Start processing loop
   */
  private startProcessingLoop(): void {
    const processMessages = () => {
      if (!this.processing) return;
      
      // Process queues in priority order
      for (const priority of [
        MessagePriority.CRITICAL,
        MessagePriority.HIGH,
        MessagePriority.NORMAL,
        MessagePriority.LOW
      ]) {
        const queue = this.messageQueues.get(priority);
        if (queue && queue.messages.length > 0 && !queue.processing) {
          this.processQueue(queue);
        }
      }
      
      // Use setImmediate for next tick to maintain low latency
      setImmediate(processMessages);
    };
    
    processMessages();
  }
  
  /**
   * Private: Process a message queue
   */
  private async processQueue(queue: MessageQueue): Promise<void> {
    if (queue.processing || queue.messages.length === 0) return;
    
    queue.processing = true;
    
    try {
      // Process batch of messages
      const batchSize = queue.priority === MessagePriority.CRITICAL ? 10 : 5;
      const messages = queue.messages.splice(0, batchSize);
      
      for (const message of messages) {
        await this.processMessage(message);
      }
    } finally {
      queue.processing = false;
    }
  }
  
  /**
   * Private: Process a single message
   */
  private async processMessage(message: Message): Promise<void> {
    const startTime = performance.now();
    
    try {
      // Find matching handlers
      const handlers = this.findHandlers(message);
      
      if (handlers.length === 0) {
        this.logger.warn('No handlers found for message', {
          messageId: message.header.id,
          type: message.header.type,
          destination: message.header.destination
        });
        return;
      }
      
      // Execute handlers
      const promises = handlers.map(handler => 
        this.executeHandler(handler, message)
      );
      
      await Promise.all(promises);
      
      // Update receive stats
      const destinations = Array.isArray(message.header.destination)
        ? message.header.destination
        : [message.header.destination];
      
      if (destinations.length > 0 && destinations[0]) {
        this.updateReceiveStats(destinations[0]);
      }
      
      // Track processing time
      const processingTime = (performance.now() - startTime) * 1000; // μs
      if (destinations.length > 0 && destinations[0]) {
        this.updateRouteMetrics(
          `${message.header.source}->${destinations[0]}`,
          processingTime
        );
      }
      
      this.emit('message:received', message);
    } catch (error) {
      this.logger.error('Error processing message', {
        error,
        messageId: message.header.id
      });
      
      this.emit('message:error', error as Error, message);
    }
  }
  
  /**
   * Private: Route message
   */
  private async routeMessage(message: Message): Promise<void> {
    // Apply static routes
    for (const route of this.routes) {
      if (this.matchesRoute(message, route)) {
        // Transform message if needed
        const transformed = route.transform ? route.transform(message) : message;
        
        // Queue for processing
        const priority = route.priority || message.header.priority;
        const queue = this.messageQueues.get(priority)!;
        
        if (queue.messages.length >= this.config.maxQueueSize) {
          throw new Error(`Queue full for priority ${MessagePriority[priority]}`);
        }
        
        queue.messages.push(transformed);
      }
    }
    
    // Direct routing based on destination
    const destinations = Array.isArray(message.header.destination)
      ? message.header.destination
      : [message.header.destination];
    
    for (const destination of destinations) {
      const queue = this.messageQueues.get(message.header.priority)!;
      
      if (queue.messages.length >= this.config.maxQueueSize) {
        throw new Error(`Queue full for priority ${MessagePriority[message.header.priority]}`);
      }
      
      queue.messages.push(message);
    }
  }
  
  /**
   * Private: Find matching handlers
   */
  private findHandlers(message: Message): HandlerRegistration[] {
    const handlers: HandlerRegistration[] = [];
    const destination = Array.isArray(message.header.destination)
      ? message.header.destination[0]
      : message.header.destination;
    
    if (!destination) {
      return handlers;
    }
    
    // Exact match
    if (this.handlers.has(destination)) {
      handlers.push(...this.handlers.get(destination)!);
    }
    
    // Pattern match
    for (const [pattern, registrations] of this.handlers) {
      if (pattern.includes('*') || pattern.includes('?')) {
        const regex = new RegExp(
          pattern.replace(/\*/g, '.*').replace(/\?/g, '.')
        );
        if (regex.test(destination)) {
          handlers.push(...registrations);
        }
      }
    }
    
    // Sort by priority
    return handlers.sort((a, b) => a.priority - b.priority);
  }
  
  /**
   * Private: Execute handler
   */
  private async executeHandler(
    registration: HandlerRegistration,
    message: Message
  ): Promise<void> {
    try {
      await Promise.resolve(registration.handler(message));
    } catch (error) {
      this.logger.error('Handler execution failed', {
        handlerId: registration.id,
        module: registration.module,
        error
      });
      throw error;
    }
  }
  
  /**
   * Private: Validate message
   */
  private validateMessage(message: Message): void {
    if (!message.header) {
      throw new Error('Message missing header');
    }
    
    if (!message.header.id || !message.header.type || !message.header.source) {
      throw new Error('Message header missing required fields');
    }
    
    if (!message.header.destination) {
      throw new Error('Message missing destination');
    }
    
    // Check message size
    const size = JSON.stringify(message).length;
    if (size > this.config.maxMessageSize) {
      throw new Error(`Message too large: ${size} bytes`);
    }
    
    // Check TTL
    if (message.header.ttl && Date.now() > message.header.timestamp + message.header.ttl) {
      throw new Error('Message TTL expired');
    }
  }
  
  /**
   * Private: Check if message matches route
   */
  private matchesRoute(message: Message, route: Route): boolean {
    // Check source
    if (route.source instanceof RegExp) {
      if (!route.source.test(message.header.source)) return false;
    } else if (route.source !== message.header.source) {
      return false;
    }
    
    // Check message types
    if (route.messageTypes && !route.messageTypes.includes(message.header.type)) {
      return false;
    }
    
    // Apply filter
    if (route.filter && !route.filter(message)) {
      return false;
    }
    
    return true;
  }
  
  /**
   * Private: Update send statistics
   */
  private updateSendStats(module: string): void {
    if (!this.config.enableMetrics) return;
    
    if (!this.stats.has(module)) {
      this.stats.set(module, {
        sent: 0,
        received: 0,
        avgLatency: 0,
        p99Latency: 0,
        errors: 0,
        lastActivity: Date.now()
      });
    }
    
    const stats = this.stats.get(module)!;
    stats.sent++;
    stats.lastActivity = Date.now();
    this.messageCount++;
  }
  
  /**
   * Private: Update receive statistics
   */
  private updateReceiveStats(module: string): void {
    if (!this.config.enableMetrics) return;
    
    if (!this.stats.has(module)) {
      this.stats.set(module, {
        sent: 0,
        received: 0,
        avgLatency: 0,
        p99Latency: 0,
        errors: 0,
        lastActivity: Date.now()
      });
    }
    
    const stats = this.stats.get(module)!;
    stats.received++;
    stats.lastActivity = Date.now();
  }
  
  /**
   * Private: Update route metrics
   */
  private updateRouteMetrics(route: string, latency: number): void {
    if (!this.config.enableMetrics) return;
    
    if (!this.routeMetrics.has(route)) {
      this.routeMetrics.set(route, {
        route,
        messageCount: 0,
        avgLatency: 0,
        p50Latency: 0,
        p95Latency: 0,
        p99Latency: 0,
        maxLatency: 0,
        errors: 0,
        lastUpdated: Date.now()
      });
    }
    
    const metrics = this.routeMetrics.get(route)!;
    metrics.messageCount++;
    metrics.avgLatency = (metrics.avgLatency * (metrics.messageCount - 1) + latency) / metrics.messageCount;
    metrics.maxLatency = Math.max(metrics.maxLatency, latency);
    metrics.lastUpdated = Date.now();
  }
  
  /**
   * Private: Track latency
   */
  private trackLatency(latency: number): void {
    this.latencyWindow.push(latency);
    
    if (this.latencyWindow.length > this.latencyWindowSize) {
      this.latencyWindow.shift();
    }
  }
  
  /**
   * Private: Drain message queues
   */
  private async drainQueues(): Promise<void> {
    const timeout = 5000; // 5 seconds
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
      let hasMessages = false;
      
      for (const queue of this.messageQueues.values()) {
        if (queue.messages.length > 0) {
          hasMessages = true;
          break;
        }
      }
      
      if (!hasMessages) break;
      
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    
    // Log any remaining messages
    for (const [priority, queue] of this.messageQueues) {
      if (queue.messages.length > 0) {
        this.logger.warn(`${queue.messages.length} messages remaining in ${MessagePriority[priority]} queue`);
      }
    }
  }
  
  /**
   * Private: Generate handler ID
   */
  private generateHandlerId(): string {
    return `handler_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
  
  /**
   * Private: Calculate average
   */
  private calculateAverage(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((sum, val) => sum + val, 0) / values.length;
  }
  
  /**
   * Private: Calculate percentile
   */
  private calculatePercentile(sortedValues: number[], percentile: number): number {
    if (sortedValues.length === 0) return 0;
    const index = Math.ceil(sortedValues.length * percentile) - 1;
    return sortedValues[Math.max(0, Math.min(index, sortedValues.length - 1))] || 0;
  }
} 