/**
 * Logger configuration for the SKB service
 */
import pino from 'pino';
import Config from '../config';

// Create a logger instance
export const logger = pino({
  level: Config.logging.level,
  name: Config.service.name,
  
  // Use pretty printing in development
  transport: Config.logging.prettyPrint
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
        },
      }
    : undefined,
    
  // Include basic app info in all logs
  base: {
    app: Config.service.name,
    version: Config.service.version,
    env: process.env.NODE_ENV || 'development',
  },
});

export default logger;