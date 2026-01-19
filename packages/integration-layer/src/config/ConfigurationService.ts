/**
 * ConfigurationService - Runtime configuration management
 * 
 * Manages system and module configurations with validation,
 * hot reload capabilities, and environment-based overrides.
 */

import { EventEmitter } from 'events';
import { Logger } from 'winston';
import * as fs from 'fs/promises';
import * as path from 'path';
import {
  Message,
  MessageType,
  MessageFactory
} from '@noderr/types/src';
import {
  SystemConfig,
  ModuleConfig,
  ConfigUpdate,
  ConfigValidation,
  ConfigError,
  ConfigSchema,
  EnvMapping,
  ConfigUtils,
  Secret,
  SecretsConfig
} from '../types/config';
import { MessageBus } from '../bus/MessageBus';

interface ConfigState {
  loaded: boolean;
  config?: SystemConfig;
  moduleConfigs: Map<string, ModuleConfig>;
  secrets: Map<string, Secret>;
  envMappings: EnvMapping[];
  schemas: Map<string, ConfigSchema>;
  configPath?: string;
  watchHandle?: fs.FileHandle;
}

export class ConfigurationService extends EventEmitter {
  private logger: Logger;
  private messageBus: MessageBus;
  private state: ConfigState = {
    loaded: false,
    moduleConfigs: new Map(),
    secrets: new Map(),
    envMappings: [],
    schemas: new Map()
  };
  
  private defaultConfig: SystemConfig = {
    environment: 'development',
    version: '1.0.0',
    debug: false,
    modules: [] as ModuleConfig[],
    messageBus: {
      maxMessageSize: 1024 * 1024,
      maxQueueSize: 10000,
      defaultTimeout: 30000,
      retryPolicy: {
        maxRetries: 3,
        initialDelay: 1000,
        maxDelay: 30000,
        backoffMultiplier: 2
      },
      deadLetterQueue: {
        enabled: true,
        maxSize: 1000,
        ttl: 86400000, // 24 hours
        processInterval: 60000,
        maxProcessAttempts: 5
      },
      performance: {
        enableMetrics: true,
        metricsInterval: 5000,
        latencyPercentiles: [0.5, 0.95, 0.99],
        slowMessageThreshold: 1000,
        enableTracing: false
      }
    },
    health: {
      enabled: true,
      interval: 30000,
      timeout: 5000,
      port: 3000,
      path: '/health',
      checks: {
        system: true,
        modules: true,
        dependencies: true,
        custom: false
      },
      thresholds: {
        cpu: { warning: 70, critical: 90 },
        memory: { warning: 80, critical: 95 },
        latency: { warning: 1000, critical: 5000 }
      }
    },
    recovery: {
      enabled: true,
      strategies: [],
      globalMaxRetries: 3,
      globalCooldown: 60000,
      alerting: {
        enabled: true,
        channels: [],
        rules: [],
        throttle: {
          maxPerHour: 100,
          maxPerDay: 1000
        }
      }
    },
    telemetry: {
      metrics: {
        enabled: true,
        provider: 'prometheus',
        endpoint: 'http://localhost:9090',
        interval: 10000,
        prefix: 'noderr',
        labels: {
          service: 'noderr-protocol',
          environment: 'development'
        }
      },
      logging: {
        level: 'info',
        format: 'json',
        outputs: [
          {
            type: 'console',
            config: {}
          }
        ],
        fields: {}
      },
      tracing: {
        enabled: false,
        provider: 'jaeger',
        endpoint: 'http://localhost:14268',
        samplingRate: 0.1,
        serviceName: 'noderr-protocol'
      }
    },
    security: {
      authentication: {
        enabled: false,
        provider: 'jwt',
        config: {}
      },
      authorization: {
        enabled: false,
        provider: 'rbac',
        policies: {}
      },
      encryption: {
        enabled: true,
        algorithm: 'aes-256-gcm',
        keyRotation: true,
        keyRotationInterval: 86400000 // 24 hours
      },
      rateLimit: {
        enabled: true,
        global: {
          requests: 1000,
          window: 60000 // 1 minute
        }
      }
    }
  };
  
  constructor(logger: Logger, messageBus: MessageBus) {
    super();
    this.logger = logger;
    this.messageBus = messageBus;
    
    this.setupEnvMappings();
    this.setupSchemas();
  }
  
  /**
   * Load configuration
   */
  async load(configPath?: string): Promise<void> {
    this.logger.info('Loading configuration');
    
    try {
      // Determine config path
      const finalPath = configPath || 
                       process.env.NODERR_CONFIG_PATH || 
                       path.join(process.cwd(), 'config', 'config.json');
      
      this.state.configPath = finalPath;
      
      // Load base config
      let config = await this.loadConfigFile(finalPath);
      
      // Apply environment overrides
      config = this.applyEnvironmentOverrides(config);
      
      // Validate configuration
      const validation = this.validateConfig(config);
      if (!validation.valid) {
        throw new Error(`Invalid configuration: ${validation.errors[0].message}`);
      }
      
      // Load secrets
      await this.loadSecrets(config.security);
      
      // Set config
      this.state.config = config;
      this.state.loaded = true;
      
      // Extract module configs
      this.extractModuleConfigs(config);
      
      // Watch for changes
      if (process.env.NODE_ENV !== 'production') {
        await this.watchConfigFile();
      }
      
      this.logger.info('Configuration loaded successfully');
      this.emit('config:loaded', config);
    } catch (error) {
      this.logger.error('Failed to load configuration', { error });
      
      // Use default config in development
      if (process.env.NODE_ENV === 'development') {
        this.logger.warn('Using default configuration');
        this.state.config = this.defaultConfig;
        this.state.loaded = true;
        this.emit('config:loaded', this.defaultConfig);
      } else {
        throw error;
      }
    }
  }
  
  /**
   * Get system configuration
   */
  getConfig(): SystemConfig {
    if (!this.state.config) {
      throw new Error('Configuration not loaded');
    }
    return this.state.config;
  }
  
  /**
   * Get module configuration
   */
  getModuleConfig(moduleId: string): ModuleConfig | undefined {
    return this.state.moduleConfigs.get(moduleId);
  }
  
  /**
   * Update configuration
   */
  async updateConfig(
    path: string,
    value: any,
    options?: {
      validate?: boolean;
      persist?: boolean;
      broadcast?: boolean;
    }
  ): Promise<void> {
    if (!this.state.config) {
      throw new Error('Configuration not loaded');
    }
    
    const oldValue = ConfigUtils.getValueByPath(this.state.config, path);
    
    // Create update record
    const update: ConfigUpdate = {
      id: `update_${Date.now()}`,
      timestamp: Date.now(),
      path,
      oldValue,
      newValue: value,
      source: 'runtime'
    };
    
    // Apply update to copy for validation
    const configCopy = JSON.parse(JSON.stringify(this.state.config));
    ConfigUtils.setValueByPath(configCopy, path, value);
    
    // Validate if requested
    if (options?.validate !== false) {
      const validation = this.validateConfig(configCopy);
      if (!validation.valid) {
        throw new Error(`Invalid configuration update: ${validation.errors[0].message}`);
      }
    }
    
    // Apply update
    ConfigUtils.setValueByPath(this.state.config, path, value);
    
    // Update module configs if needed
    if (path.startsWith('modules.')) {
      this.extractModuleConfigs(this.state.config);
    }
    
    // Persist if requested
    if (options?.persist && this.state.configPath) {
      await this.saveConfig();
    }
    
    // Broadcast if requested
    if (options?.broadcast !== false) {
      await this.broadcastUpdate(update);
    }
    
    this.logger.info(`Configuration updated: ${path}`);
    this.emit('config:updated', update);
  }
  
  /**
   * Reload configuration
   */
  async reload(): Promise<void> {
    this.logger.info('Reloading configuration');
    
    const currentConfig = this.state.config;
    
    try {
      await this.load(this.state.configPath);
      
      // Detect changes and notify modules
      if (currentConfig) {
        await this.detectAndNotifyChanges(currentConfig, this.state.config!);
      }
      
      this.emit('config:reload');
    } catch (error) {
      this.logger.error('Failed to reload configuration', { error });
      
      // Restore previous config
      this.state.config = currentConfig;
      throw error;
    }
  }
  
  /**
   * Get secret value
   */
  getSecret(name: string): string | undefined {
    const secret = this.state.secrets.get(name);
    if (!secret) return undefined;
    
    // Check expiration
    if (secret.expiresAt && Date.now() > secret.expiresAt) {
      this.state.secrets.delete(name);
      return undefined;
    }
    
    return secret.value;
  }
  
  /**
   * Set secret value
   */
  setSecret(name: string, value: string, expiresIn?: number): void {
    const secret: Secret = {
      id: `secret_${Date.now()}`,
      name,
      value,
      source: 'runtime',
      expiresAt: expiresIn ? Date.now() + expiresIn : undefined
    };
    
    this.state.secrets.set(name, secret);
    this.logger.debug(`Secret set: ${name}`);
  }
  
  /**
   * Private: Setup environment mappings
   */
  private setupEnvMappings(): void {
    this.state.envMappings = [
      {
        configPath: 'environment',
        envVar: 'NODE_ENV',
        type: 'string'
      },
      {
        configPath: 'debug',
        envVar: 'NODERR_DEBUG',
        type: 'boolean',
        transform: (value) => value === 'true'
      },
      {
        configPath: 'health.port',
        envVar: 'HEALTH_PORT',
        type: 'number',
        transform: (value) => parseInt(value, 10)
      },
      {
        configPath: 'telemetry.metrics.endpoint',
        envVar: 'METRICS_ENDPOINT',
        type: 'string'
      },
      {
        configPath: 'telemetry.logging.level',
        envVar: 'LOG_LEVEL',
        type: 'string'
      }
    ];
  }
  
  /**
   * Private: Setup configuration schemas
   */
  private setupSchemas(): void {
    // Add basic schemas for validation
    this.state.schemas.set('system', {
      type: 'object',
      properties: {
        environment: {
          type: 'string',
          enum: ['development', 'staging', 'production']
        },
        version: { type: 'string' },
        debug: { type: 'boolean' }
      },
      required: ['environment', 'version']
    });
  }
  
  /**
   * Private: Load configuration file
   */
  private async loadConfigFile(filePath: string): Promise<SystemConfig> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      
      // Support JSON and YAML
      if (filePath.endsWith('.json')) {
        return JSON.parse(content);
      } else if (filePath.endsWith('.yaml') || filePath.endsWith('.yml')) {
        // Would use yaml parser
        throw new Error('YAML not yet supported');
      } else {
        throw new Error('Unsupported config format');
      }
    } catch (error) {
      if ((error as any).code === 'ENOENT') {
        this.logger.warn(`Config file not found: ${filePath}`);
        return this.defaultConfig;
      }
      throw error;
    }
  }
  
  /**
   * Private: Apply environment overrides
   */
  private applyEnvironmentOverrides(config: SystemConfig): SystemConfig {
    const result = { ...config };
    
    for (const mapping of this.state.envMappings) {
      const envValue = process.env[mapping.envVar];
      if (envValue !== undefined) {
        const value = mapping.transform ? mapping.transform(envValue) : envValue;
        ConfigUtils.setValueByPath(result, mapping.configPath, value);
        
        this.logger.debug(`Applied env override: ${mapping.configPath} = ${value}`);
      }
    }
    
    return result;
  }
  
  /**
   * Private: Validate configuration
   */
  private validateConfig(config: SystemConfig): ConfigValidation {
    const errors: ConfigError[] = [];
    
    // Basic validation
    if (!config.environment) {
      errors.push({
        path: 'environment',
        message: 'Environment is required'
      });
    }
    
    if (!config.version) {
      errors.push({
        path: 'version',
        message: 'Version is required'
      });
    }
    
    // Validate modules
    for (let i = 0; i < config.modules.length; i++) {
      const module = config.modules[i];
      if (!module.id) {
        errors.push({
          path: `modules[${i}].id`,
          message: 'Module ID is required'
        });
      }
      
      if (!module.name) {
        errors.push({
          path: `modules[${i}].name`,
          message: 'Module name is required'
        });
      }
    }
    
    // Schema validation
    for (const [name, schema] of this.state.schemas) {
      const value = ConfigUtils.getValueByPath(config, name);
      if (value !== undefined) {
        const schemaValidation = ConfigUtils.validateAgainstSchema(value, schema);
        errors.push(...schemaValidation.errors);
      }
    }
    
    return {
      valid: errors.length === 0,
      errors,
      warnings: []
    };
  }
  
  /**
   * Private: Load secrets
   */
  private async loadSecrets(securityConfig: any): Promise<void> {
    // Load from environment variables
    const secretEnvVars = Object.keys(process.env)
      .filter(key => key.startsWith('NODERR_SECRET_'));
    
    for (const envVar of secretEnvVars) {
      const name = envVar.replace('NODERR_SECRET_', '').toLowerCase();
      const value = process.env[envVar]!;
      
      this.setSecret(name, value);
    }
    
    // Load from secrets file if configured
    if (process.env.NODERR_SECRETS_FILE) {
      try {
        const content = await fs.readFile(process.env.NODERR_SECRETS_FILE, 'utf-8');
        const secrets = JSON.parse(content);
        
        for (const [name, value] of Object.entries(secrets)) {
          this.setSecret(name, value as string);
        }
      } catch (error) {
        this.logger.error('Failed to load secrets file', { error });
      }
    }
  }
  
  /**
   * Private: Extract module configurations
   */
  private extractModuleConfigs(config: SystemConfig): void {
    this.state.moduleConfigs.clear();
    
    for (const module of config.modules) {
      this.state.moduleConfigs.set(module.id, module);
    }
  }
  
  /**
   * Private: Watch configuration file
   */
  private async watchConfigFile(): Promise<void> {
    if (!this.state.configPath) return;
    
    try {
      const watcher = fs.watch(this.state.configPath);
      
      for await (const event of watcher) {
        if (event.eventType === 'change') {
          this.logger.info('Configuration file changed, reloading');
          await this.reload();
        }
      }
    } catch (error) {
      this.logger.error('Failed to watch config file', { error });
    }
  }
  
  /**
   * Private: Save configuration
   */
  private async saveConfig(): Promise<void> {
    if (!this.state.configPath || !this.state.config) return;
    
    const content = JSON.stringify(this.state.config, null, 2);
    await fs.writeFile(this.state.configPath, content, 'utf-8');
    
    this.logger.info('Configuration saved');
  }
  
  /**
   * Private: Broadcast configuration update
   */
  private async broadcastUpdate(update: ConfigUpdate): Promise<void> {
    const message = MessageFactory.create(
      MessageType.CONFIG_UPDATE,
      update.module || '*',
      update,
      'config.service'
    );
    
    await this.messageBus.send(message);
  }
  
  /**
   * Private: Detect and notify changes
   */
  private async detectAndNotifyChanges(
    oldConfig: SystemConfig,
    newConfig: SystemConfig
  ): Promise<void> {
    // Detect module changes
    for (const newModule of newConfig.modules) {
      const oldModule = oldConfig.modules.find(m => m.id === newModule.id);
      
      if (!oldModule || JSON.stringify(oldModule) !== JSON.stringify(newModule)) {
        // Module config changed
        const update: ConfigUpdate = {
          id: `update_${Date.now()}`,
          timestamp: Date.now(),
          module: newModule.id,
          path: `modules.${newModule.id}`,
          oldValue: oldModule,
          newValue: newModule,
          source: 'file'
        };
        
        await this.broadcastUpdate(update);
      }
    }
  }
} 