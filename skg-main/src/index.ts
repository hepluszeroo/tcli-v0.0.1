/**
 * Main entry point for the SKB service
 */
import { main } from './worker/skb-worker';
import { logger } from './utils/logger';
import Config from './config';

// Log the startup
logger.info({
  name: Config.service.name,
  version: Config.service.version,
  environment: process.env.NODE_ENV || 'development',
  broker: Config.broker.url,
  topics: {
    in: Config.topics.in,
    out: Config.topics.out,
  },
}, 'Starting SKB service');

// Start the worker
main().catch((error) => {
  logger.fatal({ error }, 'Fatal error in SKB service');
  process.exit(1);
});