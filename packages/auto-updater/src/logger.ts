/**
 * Logger utility for auto-updater
 *
 * Uses Winston for structured logging via console transport only.
 * PM2 captures stdout/stderr and pm2-logrotate handles file rotation,
 * so there is no need for a separate file transport.
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
    winston.format.json(),
  ),
  defaultMeta: { service: 'auto-updater' },
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple(),
      ),
    }),
  ],
});
