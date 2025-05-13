/**
 * Health check server
 *
 * Provides HTTP endpoints for monitoring the service health and metrics
 */
import express from 'express';
import { logger } from '../utils/logger';
import Config from '../config';
import MetricsService, { getMetrics } from '../metrics/metrics';
import { graphStore } from '../graph-store';
import { MAX_GRAPH_MB } from '../graph-store/compactor';

import { Server } from 'http';

// Server instance
let server: Server | null = null;

/**
 * Start the health check HTTP server
 */
export function startHealthServer(): void {
  const app = express();
  
  // Log incoming requests
  app.use((req, res, next) => {
    logger.debug({ 
      method: req.method, 
      url: req.url 
    }, 'HTTP request received');
    next();
  });
  
  // Health check endpoint
  app.get('/healthz', (req, res) => {
    // Collect basic memory usage stats
    const memoryUsage = process.memoryUsage();

    // Get uptime info
    const uptime = process.uptime();

    // Basic health response
    const health = {
      status: 'ok',
      service: Config.service.name,
      version: Config.service.version,
      timestamp: new Date().toISOString(),
      uptime,
      memory: {
        rss: Math.round(memoryUsage.rss / 1024 / 1024), // MB
        heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024), // MB
        heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024), // MB
      },
    };

    // Log the health check
    logger.debug({ health }, 'Health check');

    // Send response
    res.json(health);
  });

  // Graph status endpoint
  app.get('/graph', async (req, res) => {
    try {
      // Get graph stats
      const stats = graphStore.stats;

      // Get file size
      const fileMB = await graphStore.getFileSizeMB();

      // Determine status
      let status = 'normal';
      let httpStatus = 200;

      if (fileMB > MAX_GRAPH_MB) {
        status = 'critical';
        httpStatus = 503; // Service Unavailable
      } else if (fileMB > MAX_GRAPH_MB * 0.8) {
        status = 'degraded';
      }

      // Build response
      const graphStatus = {
        ok: status !== 'critical',
        entities: stats.entities,
        triples: stats.triples,
        fileMB: Math.round(fileMB * 10) / 10, // Round to 1 decimal
        lastCompaction: stats.lastCompaction, // ISO string format
        lastCompactionEpoch: stats.lastCompactionMs, // Unix epoch in ms
        aliasMapEntries: stats.aliasMapEntries || 0, // Number of aliases in the map
        status
      };

      // Send response with appropriate status code
      res.status(httpStatus).json(graphStatus);

      logger.debug({ graphStatus }, 'Graph status endpoint called');
    } catch (error) {
      logger.error({ error }, 'Error serving graph status');
      res.status(500).json({ error: 'Failed to get graph status' });
    }
  });

  // Alias map status endpoint
  app.get('/alias', (req, res) => {
    try {
      // Get alias map stats
      const aliasStats = graphStore.aliasStats;

      // Build response
      const aliasStatus = {
        ok: true,
        size: aliasStats.entries,
        lastReloadIso: aliasStats.lastReload,
        lastReloadEpoch: aliasStats.lastReloadMs,
        errorCount: aliasStats.errorCount
      };

      // Send response
      res.json(aliasStatus);

      logger.debug({ aliasStatus }, 'Alias status endpoint called');
    } catch (error) {
      logger.error({ error }, 'Error serving alias status');
      res.status(500).json({ error: 'Failed to get alias status' });
    }
  });

  // Prometheus metrics endpoint
  app.get('/metrics', async (req, res) => {
    try {
      // Get metrics
      const metrics = await getMetrics();

      // Set the content type for Prometheus
      res.set('Content-Type', MetricsService.register.contentType);

      // Send the metrics
      res.end(metrics);

      logger.debug('Metrics endpoint called');
    } catch (error) {
      logger.error({ error }, 'Error serving metrics');
      res.status(500).json({ error: 'Failed to collect metrics' });
    }
  });
  
  // Catch-all for 404s
  app.use((req, res) => {
    logger.info({
      method: req.method, 
      url: req.url
    }, 'Unknown route');
    
    res.status(404).json({ 
      status: 'error', 
      message: 'Not found' 
    });
  });
  
  // Error handler
  app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
    logger.error({
      error: err,
      method: req.method,
      url: req.url
    }, 'Server error');

    res.status(500).json({
      status: 'error',
      message: 'Internal server error'
    });
  });
  
  // Start the server
  const port = Config.http.port;
  const host = Config.http.host;

  server = app.listen(port, host, () => {
    logger.info({ port, host }, 'Health check server started');
  });

  // Add error handler
  if (server) {
    server.on('error', (error: Error) => {
      logger.error({ error }, 'Health check server error');
    });
  }
}

/**
 * Stop the health check HTTP server
 */
export function stopHealthServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!server) {
      return resolve();
    }
    
    logger.info('Stopping health check server');
    
    server.close((err: Error | undefined) => {
      if (err) {
        logger.error({ error: err }, 'Error closing health check server');
        return reject(err);
      }

      logger.info('Health check server stopped');
      server = null;
      resolve();
    });
  });
}

export default { startHealthServer, stopHealthServer };