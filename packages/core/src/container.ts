import { Logger } from 'winston';
import 'reflect-metadata';
import { EventEmitter } from 'events';

export interface ServiceMetadata {
  token: string;
  dependencies?: string[];
  singleton?: boolean;
  factory?: boolean;
}

export interface ServiceInstance {
  instance: any;
  metadata: ServiceMetadata;
  initialized: boolean;
}

export class DIContainer extends EventEmitter {
  private services = new Map<string, ServiceInstance>();
  private factories = new Map<string, () => any>();
  private logger?: Logger;
  private initializationOrder: string[] = [];

  constructor(logger?: Logger) {
    super();
    this.logger = logger;
  }

  /**
   * Register a service instance
   */
  register<T>(token: string, instance: T, metadata?: Partial<ServiceMetadata>): void {
    if (this.services.has(token)) {
      throw new Error(`Service already registered: ${token}`);
    }

    const serviceMetadata: ServiceMetadata = {
      token,
      singleton: true,
      ...metadata
    };

    this.services.set(token, {
      instance,
      metadata: serviceMetadata,
      initialized: false
    });

    this.logger?.debug('Service registered', { token, singleton: serviceMetadata.singleton });
    this.emit('service:registered', { token, metadata: serviceMetadata });
  }

  /**
   * Register a factory function for lazy instantiation
   */
  registerFactory<T>(
    token: string, 
    factory: () => T, 
    metadata?: Partial<ServiceMetadata>
  ): void {
    if (this.factories.has(token)) {
      throw new Error(`Factory already registered: ${token}`);
    }

    const serviceMetadata: ServiceMetadata = {
      token,
      factory: true,
      singleton: true,
      ...metadata
    };

    this.factories.set(token, factory);
    
    // Register placeholder for metadata
    this.services.set(token, {
      instance: null,
      metadata: serviceMetadata,
      initialized: false
    });

    this.logger?.debug('Factory registered', { token });
  }

  /**
   * Get a service instance
   */
  get<T>(token: string): T {
    const service = this.services.get(token);
    
    if (!service) {
      throw new Error(`Service not found: ${token}`);
    }

    // Handle factory instantiation
    if (service.metadata.factory && !service.instance) {
      const factory = this.factories.get(token);
      if (!factory) {
        throw new Error(`Factory not found for service: ${token}`);
      }

      service.instance = factory();
      service.initialized = true;
      
      this.logger?.debug('Service instantiated from factory', { token });
      this.emit('service:instantiated', { token });
    }

    return service.instance as T;
  }

  /**
   * Check if a service is registered
   */
  has(token: string): boolean {
    return this.services.has(token);
  }

  /**
   * Get all registered service tokens
   */
  getTokens(): string[] {
    return Array.from(this.services.keys());
  }

  /**
   * Initialize all services in dependency order
   */
  async initialize(): Promise<void> {
    this.logger?.info('Initializing dependency injection container');

    // Build dependency graph
    const graph = this.buildDependencyGraph();
    
    // Topological sort for initialization order
    this.initializationOrder = this.topologicalSort(graph);

    // Initialize services in order
    for (const token of this.initializationOrder) {
      await this.initializeService(token);
    }

    this.logger?.info('All services initialized', { 
      count: this.initializationOrder.length 
    });
    
    this.emit('container:initialized');
  }

  /**
   * Initialize a single service
   */
  private async initializeService(token: string): Promise<void> {
    const service = this.services.get(token);
    if (!service || service.initialized) {
      return;
    }

    // Get instance (may trigger factory)
    const instance = this.get(token);

    // Call init method if exists
    if (instance && typeof (instance as any).init === 'function') {
      this.logger?.debug(`Initializing service: ${token}`);
      await (instance as any).init();
    }

    service.initialized = true;
    this.emit('service:initialized', { token });
  }

  /**
   * Build dependency graph
   */
  private buildDependencyGraph(): Map<string, string[]> {
    const graph = new Map<string, string[]>();

    for (const [token, service] of this.services) {
      graph.set(token, service.metadata.dependencies || []);
    }

    return graph;
  }

  /**
   * Topological sort for dependency resolution
   */
  private topologicalSort(graph: Map<string, string[]>): string[] {
    const visited = new Set<string>();
    const stack: string[] = [];

    const visit = (node: string) => {
      if (visited.has(node)) return;
      
      visited.add(node);
      const dependencies = graph.get(node) || [];
      
      for (const dep of dependencies) {
        if (!graph.has(dep)) {
          throw new Error(`Dependency not found: ${dep} required by ${node}`);
        }
        visit(dep);
      }
      
      stack.push(node);
    };

    for (const node of graph.keys()) {
      visit(node);
    }

    return stack;
  }

  /**
   * Resolve dependencies for a service
   */
  resolveDependencies(token: string): any[] {
    const service = this.services.get(token);
    if (!service) {
      throw new Error(`Service not found: ${token}`);
    }

    const dependencies = service.metadata.dependencies || [];
    return dependencies.map(dep => this.get(dep));
  }

  /**
   * Create a child container with isolated scope
   */
  createScope(): DIContainer {
    const child = new DIContainer(this.logger);
    
    // Copy singleton services
    for (const [token, service] of this.services) {
      if (service.metadata.singleton) {
        child.services.set(token, service);
      }
    }
    
    // Copy factories
    for (const [token, factory] of this.factories) {
      child.factories.set(token, factory);
    }

    return child;
  }

  /**
   * Dispose of all services
   */
  async dispose(): Promise<void> {
    this.logger?.info('Disposing dependency injection container');

    // Dispose in reverse initialization order
    const disposeOrder = [...this.initializationOrder].reverse();

    for (const token of disposeOrder) {
      const service = this.services.get(token);
      if (!service) continue;

      const instance = service.instance;
      if (instance && typeof instance.dispose === 'function') {
        this.logger?.debug(`Disposing service: ${token}`);
        await instance.dispose();
      }
    }

    this.services.clear();
    this.factories.clear();
    this.initializationOrder = [];

    this.emit('container:disposed');
  }

  /**
   * Get container statistics
   */
  getStats(): {
    totalServices: number;
    initialized: number;
    factories: number;
    singletons: number;
  } {
    let initialized = 0;
    let singletons = 0;

    for (const service of this.services.values()) {
      if (service.initialized) initialized++;
      if (service.metadata.singleton) singletons++;
    }

    return {
      totalServices: this.services.size,
      initialized,
      factories: this.factories.size,
      singletons
    };
  }
}

// Service decorator for TypeScript
export function Service(metadata?: Partial<ServiceMetadata>) {
  return function (target: any) {
    Reflect.defineMetadata('service:metadata', metadata || {}, target);
    return target;
  };
}

// Inject decorator for TypeScript
export function Inject(token: string) {
  return function (target: any, propertyKey: string | symbol, parameterIndex: number) {
    const existingTokens = Reflect.getMetadata('inject:tokens', target) || [];
    existingTokens[parameterIndex] = token;
    Reflect.defineMetadata('inject:tokens', existingTokens, target);
  };
} 