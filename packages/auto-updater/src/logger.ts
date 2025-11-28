/**
 * Logger utility for auto-updater
 * 
 * Uses Winston for structured logging
 * 
 * @module logger
 */

import winston from 'winston';

/**
 * Create logger instance
 */
export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'auto-updater' },
  transports: [
    // Console output
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      ),
    }),
    
    // File output (errors)
    new winston.transports.File({
      filename: '/var/log/noderr/auto-updater-error.log',
      level: 'error',
    }),
    
    // File output (all logs)
    new winston.transports.File({
      filename: '/var/log/noderr/auto-updater.log',
    }),
  ],
});
