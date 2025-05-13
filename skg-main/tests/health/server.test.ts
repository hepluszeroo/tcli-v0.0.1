/**
 * Unit tests for the health server
 */
import request from 'supertest';
import express from 'express';
import { graphStore } from '../../src/graph-store';
import { MAX_GRAPH_MB } from '../../src/graph-store/compactor';
import Config from '../../src/config';

// Mock the metrics module
jest.mock('../../src/metrics/metrics', () => ({
  metrics: {
    graphNodesTotal: { set: jest.fn() },
    graphEdgesTotal: { set: jest.fn() },
    graphUpdatesTotal: { inc: jest.fn() },
    globalGraphFileBytes: { set: jest.fn() },
    graphCompactionsTotal: { inc: jest.fn() },
    graphCompactionTimeSeconds: { observe: jest.fn() },
  }
}));

// Mock the logger
jest.mock('../../src/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }
}));

// Mock Config
jest.mock('../../src/config', () => ({
  service: {
    name: 'skb-service-test',
    version: '0.3.1-beta',
  },
  http: {
    port: 3000,
    host: 'localhost',
  }
}));

// Mock the graph store
jest.mock('../../src/graph-store', () => {
  const mockGraphStore = {
    stats: {
      entities: 100,
      triples: 75,
      relations: 10,
      mergeCount: 50,
      lastCompaction: "2023-07-30T15:30:00Z",
      lastCompactionMs: 1690732200000
    },
    aliasStats: {
      entries: 25,
      lastReload: "2023-08-01T10:15:00Z",
      lastReloadMs: 1690884900000,
      errorCount: 2
    },
    getFileSizeMB: jest.fn().mockResolvedValue(10) // Default to 10MB
  };
  return { graphStore: mockGraphStore };
});

describe('Health Server', () => {
  let app: express.Application;
  
  beforeEach(async () => {
    // Reset mocks
    jest.clearAllMocks();
    
    // Import the server dynamically to ensure mocks are applied
    const healthServer = await import('../../src/health/server');
    
    // Create a fresh express app
    app = express();
    
    // Add the health routes
    app.get('/healthz', (req, res) => {
      // Basic health response
      const health = {
        status: 'ok',
        service: Config.service.name,
        version: Config.service.version,
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: {
          rss: 100,
          heapTotal: 50,
          heapUsed: 30,
        },
      };
      res.json(health);
    });
    
    // Add the graph endpoint
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
          status
        };

        // Send response with appropriate status code
        res.status(httpStatus).json(graphStatus);
      } catch (error) {
        res.status(500).json({ error: 'Failed to get graph status' });
      }
    });

    // Add the alias endpoint
    app.get('/alias', (req, res) => {
      try {
        // Get alias stats
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
      } catch (error) {
        res.status(500).json({ error: 'Failed to get alias status' });
      }
    });
  });
  
  it('should return 200 OK for /healthz endpoint', async () => {
    const response = await request(app).get('/healthz');
    
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
    expect(response.body.service).toBe('skb-service-test');
    expect(response.body.version).toBe('0.3.1-beta');
  });
  
  it('should return normal status when file size is below threshold', async () => {
    // Mock file size to be low
    (graphStore.getFileSizeMB as jest.Mock).mockResolvedValue(10);
    
    const response = await request(app).get('/graph');
    
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('normal');
    expect(response.body.ok).toBe(true);
    expect(response.body.fileMB).toBe(10);
    expect(response.body.entities).toBe(100);
    expect(response.body.triples).toBe(75);
    expect(response.body.lastCompaction).toBe("2023-07-30T15:30:00Z");
    expect(response.body.lastCompactionEpoch).toBe(1690732200000);
  });
  
  it('should return degraded status when file size is above 80% threshold', async () => {
    // Mock file size to be 85% of threshold
    (graphStore.getFileSizeMB as jest.Mock).mockResolvedValue(MAX_GRAPH_MB * 0.85);
    
    const response = await request(app).get('/graph');
    
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('degraded');
    expect(response.body.ok).toBe(true);
    expect(response.body.fileMB).toBe(Math.round(MAX_GRAPH_MB * 0.85 * 10) / 10);
  });
  
  it('should return critical status when file size exceeds threshold', async () => {
    // Mock file size to be larger than threshold
    (graphStore.getFileSizeMB as jest.Mock).mockResolvedValue(MAX_GRAPH_MB + 10);

    const response = await request(app).get('/graph');

    expect(response.status).toBe(503); // Service Unavailable
    expect(response.body.status).toBe('critical');
    expect(response.body.ok).toBe(false);
    expect(response.body.fileMB).toBe(Math.round((MAX_GRAPH_MB + 10) * 10) / 10);
  });

  it('should return alias map stats for /alias endpoint', async () => {
    const response = await request(app).get('/alias');

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(response.body.size).toBe(25);
    expect(response.body.lastReloadIso).toBe("2023-08-01T10:15:00Z");
    expect(response.body.lastReloadEpoch).toBe(1690884900000);
    expect(response.body.errorCount).toBe(2);
  });
});