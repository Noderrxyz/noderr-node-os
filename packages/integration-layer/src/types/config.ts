/**
 * Configuration Types - Runtime configuration management
 * 
 * Type definitions for managing system-wide and module-specific
 * configurations with validation and hot-reload capabilities.
 */

export interface SystemConfig {
  environment: 'development' | 'staging' | 'production';
  version: string;
  debug: boolean;
  modules: ModuleConfig[];
  messageBus: MessageBusConfig;
  health: HealthConfig;
  recovery: RecoveryConfig;
  telemetry: TelemetryConfig;
  security?: SecurityConfig;
}

export interface ModuleConfig {
  id: string;
  name: string;
  enabled: boolean;
  version: string;
  config: Record<string, any>;
  resources?: ResourceConfig;
  dependencies?: string[];
  autoStart?: boolean;
  restartPolicy?: RestartPolicy;
}

export interface ResourceConfig {
  cpu?: {
    limit?: number; // Percentage
    reservation?: number;
  };
  memory?: {
    limit?: number; // MB
    reservation?: number;
  };
  connections?: {
    max?: number;
    poolSize?: number;
  };
}

export interface RestartPolicy {
  maxRetries: number;
  delay: number; // ms
  backoffMultiplier: number;
  maxDelay: number;
  window: number; // Time window for retry count
}

export interface MessageBusConfig {
  maxMessageSize: number; // bytes
  maxQueueSize: number;
  defaultTimeout: number; // ms
  retryPolicy: RetryPolicy;
  deadLetterQueue: DeadLetterConfig;
  performance: PerformanceConfig;
}

export interface RetryPolicy {
  maxRetries: number;
  initialDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
  retryableErrors?: string[];
}

export interface DeadLetterConfig {
  enabled: boolean;
  maxSize: number;
  ttl: number; // Time to live in ms
  processInterval: number;
  maxProcessAttempts: number;
}

export interface PerformanceConfig {
  enableMetrics: boolean;
  metricsInterval: number;
  latencyPercentiles: number[];
  slowMessageThreshold: number; // ms
  enableTracing: boolean;
}

export interface HealthConfig {
  enabled: boolean;
  interval: number;
  timeout: number;
  port: number;
  path: string;
  checks: {
    system: boolean;
    modules: boolean;
    dependencies: boolean;
    custom: boolean;
  };
  thresholds: {
    cpu: { warning: number; critical: number };
    memory: { warning: number; critical: number };
    latency: { warning: number; critical: number };
  };
}

export interface RecoveryConfig {
  enabled: boolean;
  strategies: RecoveryStrategyConfig[];
  globalMaxRetries: number;
  globalCooldown: number;
  alerting: AlertingConfig;
}

export interface RecoveryStrategyConfig {
  name: string;
  modules: string[];
  triggers: TriggerConfig[];
  actions: ActionConfig[];
  priority: number;
}

export interface TriggerConfig {
  type: string;
  threshold: number;
  duration: number;
  condition: string;
}

export interface ActionConfig {
  type: string;
  delay: number;
  timeout: number;
  fallback?: string;
}

export interface AlertingConfig {
  enabled: boolean;
  channels: AlertChannel[];
  rules: AlertRule[];
  throttle: {
    maxPerHour: number;
    maxPerDay: number;
  };
}

export interface AlertChannel {
  type: 'slack' | 'email' | 'webhook' | 'pagerduty';
  name: string;
  config: Record<string, any>;
  severity?: string[];
}

export interface AlertRule {
  name: string;
  condition: string;
  severity: 'info' | 'warning' | 'error' | 'critical';
  channels: string[];
  throttle?: number;
}

export interface TelemetryConfig {
  metrics: MetricsConfig;
  logging: LoggingConfig;
  tracing: TracingConfig;
}

export interface MetricsConfig {
  enabled: boolean;
  provider: 'prometheus' | 'influx' | 'cloudwatch';
  endpoint: string;
  interval: number;
  prefix: string;
  labels: Record<string, string>;
}

export interface LoggingConfig {
  level: 'debug' | 'info' | 'warn' | 'error';
  format: 'json' | 'text';
  outputs: LogOutput[];
  fields: Record<string, any>;
}

export interface LogOutput {
  type: 'console' | 'file' | 'syslog' | 'http';
  level?: string;
  config: Record<string, any>;
}

export interface TracingConfig {
  enabled: boolean;
  provider: 'jaeger' | 'zipkin' | 'datadog';
  endpoint: string;
  samplingRate: number;
  serviceName: string;
}

export interface SecurityConfig {
  authentication: AuthConfig;
  authorization: AuthzConfig;
  encryption: EncryptionConfig;
  rateLimit: RateLimitConfig;
}

export interface AuthConfig {
  enabled: boolean;
  provider: 'jwt' | 'oauth' | 'api-key';
  config: Record<string, any>;
}

export interface AuthzConfig {
  enabled: boolean;
  provider: 'rbac' | 'abac';
  policies: Record<string, any>;
}

export interface EncryptionConfig {
  enabled: boolean;
  algorithm: string;
  keyRotation: boolean;
  keyRotationInterval: number;
}

export interface RateLimitConfig {
  enabled: boolean;
  global: {
    requests: number;
    window: number;
  };
  perModule?: Record<string, { requests: number; window: number }>;
}

// Configuration Management Types
export interface ConfigUpdate {
  id: string;
  timestamp: number;
  module?: string;
  path: string;
  oldValue: any;
  newValue: any;
  source: 'file' | 'api' | 'env' | 'runtime';
  appliedBy?: string;
}

export interface ConfigValidation {
  valid: boolean;
  errors: ConfigError[];
  warnings: ConfigWarning[];
}

export interface ConfigError {
  path: string;
  message: string;
  value?: any;
  expected?: string;
}

export interface ConfigWarning {
  path: string;
  message: string;
  suggestion?: string;
}

// Configuration Events
export interface ConfigEvents {
  'config:loaded': (config: SystemConfig) => void;
  'config:updated': (update: ConfigUpdate) => void;
  'config:validated': (validation: ConfigValidation) => void;
  'config:error': (error: Error) => void;
  'config:reload': () => void;
}

// Configuration Schema
export interface ConfigSchema {
  type: 'object' | 'array' | 'string' | 'number' | 'boolean';
  properties?: Record<string, ConfigSchema>;
  items?: ConfigSchema;
  required?: string[];
  enum?: any[];
  minimum?: number;
  maximum?: number;
  pattern?: string;
  default?: any;
  description?: string;
}

// Environment Variable Mapping
export interface EnvMapping {
  configPath: string;
  envVar: string;
  type: 'string' | 'number' | 'boolean' | 'json';
  required?: boolean;
  default?: any;
  transform?: (value: string) => any;
}

// Secrets Management
export interface Secret {
  id: string;
  name: string;
  value?: string; // Only in memory, never logged
  source: 'env' | 'file' | 'vault' | 'kms';
  metadata?: Record<string, any>;
  expiresAt?: number;
}

export interface SecretsConfig {
  provider: 'env' | 'file' | 'vault' | 'aws-secrets' | 'azure-keyvault';
  config: Record<string, any>;
  refreshInterval?: number;
  cache?: boolean;
}

// Configuration Utilities
export class ConfigUtils {
  static merge(base: any, override: any): any {
    if (!override) return base;
    if (!base) return override;
    
    const result = { ...base };
    
    for (const key in override) {
      if (override[key] !== undefined) {
        if (typeof override[key] === 'object' && !Array.isArray(override[key])) {
          result[key] = this.merge(base[key], override[key]);
        } else {
          result[key] = override[key];
        }
      }
    }
    
    return result;
  }
  
  static getValueByPath(obj: any, path: string): any {
    return path.split('.').reduce((current, key) => current?.[key], obj);
  }
  
  static setValueByPath(obj: any, path: string, value: any): void {
    const keys = path.split('.');
    const lastKey = keys.pop()!;
    const target = keys.reduce((current, key) => {
      if (!current[key]) current[key] = {};
      return current[key];
    }, obj);
    
    target[lastKey] = value;
  }
  
  static validateAgainstSchema(value: any, schema: ConfigSchema): ConfigValidation {
    const errors: ConfigError[] = [];
    const warnings: ConfigWarning[] = [];
    
    // Basic type validation
    if (schema.type && typeof value !== schema.type) {
      errors.push({
        path: '',
        message: `Expected ${schema.type} but got ${typeof value}`,
        value,
        expected: schema.type
      });
    }
    
    // Additional validations based on schema...
    
    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }
} 