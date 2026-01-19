import winston from 'winston';
import { OnChainServiceConfig } from '@noderr/types/src';

/**
 * Create and configure Winston logger
 */
export function createLogger(config: OnChainServiceConfig): winston.Logger {
  const transports: winston.transport[] = [
    // Console transport
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        winston.format.printf(({ timestamp, level, message, ...meta }) => {
          const metaStr = Object.keys(meta).length ? JSON.stringify(meta, null, 2) : '';
          return `${timestamp} [${level}]: ${message} ${metaStr}`;
        })
      ),
    }),
  ];

  // Add file transport if configured
  if (config.logFile) {
    transports.push(
      new winston.transports.File({
        filename: config.logFile,
        format: winston.format.combine(
          winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
          winston.format.json()
        ),
      })
    );
  }

  return winston.createLogger({
    level: config.logLevel,
    transports,
    exceptionHandlers: [
      new winston.transports.Console(),
      ...(config.logFile ? [new winston.transports.File({ filename: config.logFile })] : []),
    ],
    rejectionHandlers: [
      new winston.transports.Console(),
      ...(config.logFile ? [new winston.transports.File({ filename: config.logFile })] : []),
    ],
  });
}
