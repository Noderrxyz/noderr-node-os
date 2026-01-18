import { Logger } from 'winston';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as dotenv from 'dotenv';
import * as Joi from 'joi';
import _ from 'lodash';
import { EventEmitter } from 'events';

export interface SystemConfig {
  environment: 'development' | 'staging' | 'production';
  
  // Core settings
  core: {
    name: string;
    version: string;
    logLevel: string;
    timezone: string;
  };
  
  // Exchange configurations
  exchanges: {
    [key: string]: {
      enabled: boolean;
      apiKey?: string;
      apiSecret?: string;
      testnet?: boolean;
      rateLimit?: number;
      timeout?: number;
    };
  };
  
  // Risk management
  risk: {
    maxPositionSize: number;
    maxLeverage: number;
    stopLossPercentage: number;
    dailyLossLimit: number;
    varConfidence: number;
    marginCallThreshold: number;
  };
  
  // Execution settings
  execution: {
    defaultSlippage: number;
    maxSlippage: number;
    orderTimeout: number;
    retryAttempts: number;
    splitThreshold: number;
    darkPoolAccess: boolean;
  };
  
  // ML/AI settings
  ml: {
    enabled: boolean;
    modelPath: string;
    updateFrequency: number;
    minConfidence: number;
    maxGpuMemory?: number;
  };
  
  // Database settings
  database: {
    postgres: {
      host: string;
      port: number;
      database: string;
      user: string;
      password?: string;
      ssl?: boolean;
    };
    redis: {
      host: string;
      port: number;
      password?: string;
      db?: number;
    };
    timescale?: {
      enabled: boolean;
      retention: number;
    };
  };
  
  // Telemetry settings
  telemetry: {
    enabled: boolean;
    metricsPort: number;
    tracingEnabled: boolean;
    samplingRate: number;
    exporters: string[];
  };
  
  // Security settings
  security: {
    jwtSecret?: string;
    apiKeyRotation: boolean;
    encryptionKey?: string;
    whitelistedIPs?: string[];
    twoFactorEnabled: boolean;
  };
}

export class ConfigService extends EventEmitter {
  private config: SystemConfig | null = null;
  private logger: Logger;
  private configPath: string;
  private environment: string;
  private watchInterval?: NodeJS.Timeout;
  private lastModified?: number;

  constructor(logger: Logger, configPath: string = './config') {
    super();
    this.logger = logger;
    this.configPath = configPath;
    this.environment = process.env.NODE_ENV || 'development';
  }

  /**
   * Load configuration from files and environment
   */
  async load(environment?: string): Promise<void> {
    if (environment) {
      this.environment = environment;
    }

    this.logger.info('Loading configuration', { environment: this.environment });

    try {
      // Load environment variables
      this.loadEnvironmentVariables();

      // Load base configuration
      const baseConfig = await this.loadConfigFile('default.json');
      
      // Load environment-specific configuration
      const envConfig = await this.loadConfigFile(`${this.environment}.json`);
      
      // Merge configurations
      this.config = _.merge({}, baseConfig, envConfig) as SystemConfig;
      
      // Override with environment variables
      this.applyEnvironmentOverrides();
      
      // Validate configuration
      await this.validateConfig();
      
      // Mask sensitive values for logging
      const maskedConfig = this.maskSensitiveValues(this.config);
      this.logger.info('Configuration loaded successfully', { config: maskedConfig });
      
      // Emit configuration loaded event
      this.emit('config:loaded', this.config);
      
    } catch (error) {
      this.logger.error('Failed to load configuration', error);
      throw error;
    }
  }

  /**
   * Get configuration value by path
   */
  get<T = any>(path: string, defaultValue?: T): T {
    if (!this.config) {
      throw new Error('Configuration not loaded');
    }
    
    const value = _.get(this.config, path, defaultValue);
    
    if (value === undefined && defaultValue === undefined) {
      throw new Error(`Configuration value not found: ${path}`);
    }
    
    return value as T;
  }

  /**
   * Set configuration value (runtime only, not persisted)
   */
  set(path: string, value: any): void {
    if (!this.config) {
      throw new Error('Configuration not loaded');
    }
    
    const oldValue = _.get(this.config, path);
    _.set(this.config, path, value);
    
    this.emit('config:changed', { path, oldValue, newValue: value });
    this.logger.debug('Configuration value updated', { path, value });
  }

  /**
   * Get entire configuration object
   */
  getAll(): SystemConfig {
    if (!this.config) {
      throw new Error('Configuration not loaded');
    }
    
    return _.cloneDeep(this.config);
  }

  /**
   * Validate configuration against schema
   */
  private async validateConfig(): Promise<void> {
    const schema = Joi.object({
      environment: Joi.string().valid('development', 'staging', 'production').required(),
      
      core: Joi.object({
        name: Joi.string().required(),
        version: Joi.string().required(),
        logLevel: Joi.string().valid('error', 'warn', 'info', 'debug').required(),
        timezone: Joi.string().required()
      }).required(),
      
      exchanges: Joi.object().pattern(
        Joi.string(),
        Joi.object({
          enabled: Joi.boolean().required(),
          apiKey: Joi.string().when('enabled', { is: true, then: Joi.required() }),
          apiSecret: Joi.string().when('enabled', { is: true, then: Joi.required() }),
          testnet: Joi.boolean(),
          rateLimit: Joi.number().positive(),
          timeout: Joi.number().positive()
        })
      ).required(),
      
      risk: Joi.object({
        maxPositionSize: Joi.number().positive().required(),
        maxLeverage: Joi.number().positive().max(100).required(),
        stopLossPercentage: Joi.number().positive().max(100).required(),
        dailyLossLimit: Joi.number().positive().required(),
        varConfidence: Joi.number().positive().max(1).required(),
        marginCallThreshold: Joi.number().positive().max(1).required()
      }).required(),
      
      execution: Joi.object({
        defaultSlippage: Joi.number().positive().max(1).required(),
        maxSlippage: Joi.number().positive().max(1).required(),
        orderTimeout: Joi.number().positive().required(),
        retryAttempts: Joi.number().integer().min(0).required(),
        splitThreshold: Joi.number().positive().required(),
        darkPoolAccess: Joi.boolean().required()
      }).required(),
      
      ml: Joi.object({
        enabled: Joi.boolean().required(),
        modelPath: Joi.string().required(),
        updateFrequency: Joi.number().positive().required(),
        minConfidence: Joi.number().positive().max(1).required(),
        maxGpuMemory: Joi.number().positive()
      }).required(),
      
      database: Joi.object({
        postgres: Joi.object({
          host: Joi.string().required(),
          port: Joi.number().port().required(),
          database: Joi.string().required(),
          user: Joi.string().required(),
          password: Joi.string(),
          ssl: Joi.boolean()
        }).required(),
        redis: Joi.object({
          host: Joi.string().required(),
          port: Joi.number().port().required(),
          password: Joi.string(),
          db: Joi.number().integer().min(0)
        }).required(),
        timescale: Joi.object({
          enabled: Joi.boolean().required(),
          retention: Joi.number().positive().required()
        })
      }).required(),
      
      telemetry: Joi.object({
        enabled: Joi.boolean().required(),
        metricsPort: Joi.number().port().required(),
        tracingEnabled: Joi.boolean().required(),
        samplingRate: Joi.number().positive().max(1).required(),
        exporters: Joi.array().items(Joi.string()).required()
      }).required(),
      
      security: Joi.object({
        jwtSecret: Joi.string().min(32),
        apiKeyRotation: Joi.boolean().required(),
        encryptionKey: Joi.string().min(32),
        whitelistedIPs: Joi.array().items(Joi.string().ip()),
        twoFactorEnabled: Joi.boolean().required()
      }).required()
    });

    const { error } = schema.validate(this.config);
    if (error) {
      throw new Error(`Configuration validation failed: ${error.message}`);
    }
  }

  /**
   * Load configuration file
   */
  private async loadConfigFile(filename: string): Promise<any> {
    const filePath = path.join(this.configPath, filename);
    
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(content);
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        this.logger.warn(`Configuration file not found: ${filename}`);
        return {};
      }
      throw error;
    }
  }

  /**
   * Load environment variables
   */
  private loadEnvironmentVariables(): void {
    // Load .env file if exists
    const envFile = `.env.${this.environment}`;
    dotenv.config({ path: envFile });
    
    // Also load default .env
    dotenv.config();
  }

  /**
   * Apply environment variable overrides
   */
  private applyEnvironmentOverrides(): void {
    if (!this.config) return;

    // Map environment variables to config paths
    const envMappings: { [key: string]: string } = {
      'NODERR_LOG_LEVEL': 'core.logLevel',
      'NODERR_EXCHANGE_BINANCE_API_KEY': 'exchanges.binance.apiKey',
      'NODERR_EXCHANGE_BINANCE_API_SECRET': 'exchanges.binance.apiSecret',
      'NODERR_DB_POSTGRES_HOST': 'database.postgres.host',
      'NODERR_DB_POSTGRES_PORT': 'database.postgres.port',
      'NODERR_DB_POSTGRES_USER': 'database.postgres.user',
      'NODERR_DB_POSTGRES_PASSWORD': 'database.postgres.password',
      'NODERR_DB_REDIS_HOST': 'database.redis.host',
      'NODERR_DB_REDIS_PORT': 'database.redis.port',
      'NODERR_DB_REDIS_PASSWORD': 'database.redis.password',
      'NODERR_SECURITY_JWT_SECRET': 'security.jwtSecret',
      'NODERR_SECURITY_ENCRYPTION_KEY': 'security.encryptionKey'
    };

    for (const [envVar, configPath] of Object.entries(envMappings)) {
      const value = process.env[envVar];
      if (value !== undefined) {
        // Convert numeric strings to numbers
        const numValue = Number(value);
        const finalValue = !isNaN(numValue) && configPath.includes('port') ? numValue : value;
        
        _.set(this.config, configPath, finalValue);
        this.logger.debug(`Applied environment override: ${configPath}`);
      }
    }
  }

  /**
   * Mask sensitive values for logging
   */
  private maskSensitiveValues(config: any): any {
    const masked = _.cloneDeep(config);
    const sensitiveKeys = ['apiKey', 'apiSecret', 'password', 'jwtSecret', 'encryptionKey'];
    
    const maskObject = (obj: any) => {
      for (const key in obj) {
        if (sensitiveKeys.includes(key) && typeof obj[key] === 'string') {
          obj[key] = '***MASKED***';
        } else if (typeof obj[key] === 'object' && obj[key] !== null) {
          maskObject(obj[key]);
        }
      }
    };
    
    maskObject(masked);
    return masked;
  }

  /**
   * Watch configuration files for changes
   */
  async watchForChanges(interval: number = 5000): Promise<void> {
    this.logger.info('Starting configuration file watcher', { interval });
    
    this.watchInterval = setInterval(async () => {
      try {
        const stats = await fs.stat(path.join(this.configPath, `${this.environment}.json`));
        const modified = stats.mtimeMs;
        
        if (this.lastModified && modified > this.lastModified) {
          this.logger.info('Configuration file changed, reloading...');
          await this.load();
        }
        
        this.lastModified = modified;
      } catch (error) {
        this.logger.error('Error checking configuration file', error);
      }
    }, interval);
  }

  /**
   * Stop watching for changes
   */
  stopWatching(): void {
    if (this.watchInterval) {
      clearInterval(this.watchInterval);
      this.watchInterval = undefined;
      this.logger.info('Stopped configuration file watcher');
    }
  }

  /**
   * Export configuration (for debugging/backup)
   */
  async export(outputPath: string, includeSensitive: boolean = false): Promise<void> {
    if (!this.config) {
      throw new Error('Configuration not loaded');
    }
    
    const configToExport = includeSensitive 
      ? this.config 
      : this.maskSensitiveValues(this.config);
    
    await fs.writeFile(
      outputPath,
      JSON.stringify(configToExport, null, 2),
      'utf-8'
    );
    
    this.logger.info('Configuration exported', { outputPath, includeSensitive });
  }
} 