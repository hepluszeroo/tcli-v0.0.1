/**
 * Metrics module for SKB service using Prometheus client
 */
import client from 'prom-client';
import { logger } from '../utils/logger';

// Initialize Prometheus registry
const register = new client.Registry();

// Add default metrics (CPU, memory, event loop, etc.)
client.collectDefaultMetrics({ register });

// Application-specific metrics
export const metrics = {
  // Counter for total notes processed
  notesProcessed: new client.Counter({
    name: 'skb_notes_processed_total',
    help: 'Total number of notes processed',
    labelNames: ['status'] as const,
    registers: [register],
  }),

  // Counter for duplicate events detected
  duplicatesDetected: new client.Counter({
    name: 'skb_duplicates_detected_total',
    help: 'Total number of duplicate events detected',
    registers: [register],
  }),

  // Counter for validation errors
  validationErrors: new client.Counter({
    name: 'skb_validation_errors_total',
    help: 'Total number of validation errors',
    registers: [register],
  }),

  // Gauge for event processing time
  processingTime: new client.Histogram({
    name: 'skb_processing_time_seconds',
    help: 'Time taken to process a note',
    buckets: [0.01, 0.05, 0.1, 0.5, 1, 2],
    registers: [register],
  }),

  // Gauge for processed event cache size
  eventCacheSize: new client.Gauge({
    name: 'skb_event_cache_size',
    help: 'Size of the processed event cache',
    registers: [register],
  }),

  // Counter for knowledge fragments generated
  fragmentsGenerated: new client.Counter({
    name: 'skb_fragments_generated_total',
    help: 'Number of KG fragments successfully created',
    registers: [register],
  }),

  // Counter for KGGen extraction failures
  kggenFailures: new client.Counter({
    name: 'skb_kggen_failures_total',
    help: 'Number of KGGen extraction failures',
    registers: [register],
  }),

  // Histogram for KGGen execution time in milliseconds
  kggenExecutionTime: new client.Histogram({
    name: 'skb_kggen_execution_time_ms',
    help: 'Execution time of KGGen CLI in milliseconds',
    buckets: [100, 500, 1000, 2000, 5000, 10000, 30000, 60000, 120000],
    registers: [register],
  }),

  // Counter for successful fragment generation
  fragmentedSuccess: new client.Counter({
    name: 'skb_fragmented_success_total',
    help: 'Fragments successfully generated',
    registers: [register],
  }),

  // Counter for fragment generation errors
  fragmentedError: new client.Counter({
    name: 'skb_fragmented_error_total',
    help: 'Fragment generation errors',
    registers: [register],
  }),

  // Counter for skipped duplicates
  fragmentedSkipped: new client.Counter({
    name: 'skb_fragmented_skipped_total',
    help: 'Fragments skipped because duplicate',
    registers: [register],
  }),

  // Gauge for fragments loaded from disk at startup
  fragmentsLoaded: new client.Gauge({
    name: 'skb_fragments_loaded_total',
    help: 'Fragments loaded from disk at startup',
    registers: [register],
  }),

  // --- Global Graph Metrics ---

  // Gauge for total number of nodes in the global graph
  graphNodesTotal: new client.Gauge({
    name: 'skb_graph_nodes_total',
    help: 'Total number of nodes in the global knowledge graph',
    registers: [register],
  }),

  // Gauge for total number of edges in the global graph
  graphEdgesTotal: new client.Gauge({
    name: 'skb_graph_edges_total',
    help: 'Total number of edges in the global knowledge graph',
    registers: [register],
  }),

  // Counter for entity alias resolution hits
  aliasHitsTotal: new client.Counter({
    name: 'skb_alias_hits_total',
    help: 'Total number of entity alias resolutions during graph merging',
    registers: [register],
  }),

  // Counter for graph merge conflicts
  mergeConflictsTotal: new client.Counter({
    name: 'skb_merge_conflicts_total',
    help: 'Total number of conflicts detected during graph merging',
    registers: [register],
  }),

  // Histogram for fragment merge time in milliseconds
  fragmentMergeTime: new client.Histogram({
    name: 'skb_fragment_merge_time_ms',
    help: 'Time taken to merge a fragment into the global graph in milliseconds',
    buckets: [1, 5, 10, 50, 100, 500, 1000],
    registers: [register],
  }),

  // Counter for graph updates
  graphUpdatesTotal: new client.Counter({
    name: 'skb_graph_updates_total',
    help: 'Total number of updates to the global graph',
    registers: [register],
  }),

  // Counter for graph compactions
  graphCompactionsTotal: new client.Counter({
    name: 'skb_graph_compactions_total',
    help: 'Total number of global graph compactions performed',
    registers: [register],
  }),

  // Counter for alias map reloads
  aliasMapReloadsTotal: new client.Counter({
    name: 'skb_alias_map_reloads_total',
    help: 'Total number of alias map reloads performed',
    registers: [register],
  }),

  // Counter for alias map reload errors
  aliasMapReloadErrorsTotal: new client.Counter({
    name: 'skb_alias_map_reload_errors_total',
    help: 'Total number of alias map reload errors',
    registers: [register],
  }),

  // Histogram for alias map reload time in milliseconds
  aliasMapReloadTimeSeconds: new client.Histogram({
    name: 'skb_alias_map_reload_time_seconds',
    help: 'Time taken to reload the alias map in seconds',
    buckets: [0.01, 0.05, 0.1, 0.5, 1, 2],
    registers: [register],
  }),

  // Gauge for alias map size (entries)
  aliasMapSize: new client.Gauge({
    name: 'skb_alias_map_size',
    help: 'Current number of entries in the alias map',
    registers: [register],
  }),
};

/**
 * Get all metrics for Prometheus scraping
 * @returns Promise resolving to metrics string
 */
export async function getMetrics(): Promise<string> {
  try {
    return await register.metrics();
  } catch (err) {
    logger.error({ error: err }, 'Error collecting metrics');
    throw err;
  }
}

export default {
  metrics,
  getMetrics,
  register
};