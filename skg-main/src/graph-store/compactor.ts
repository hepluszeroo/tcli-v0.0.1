/**
 * Graph Store Compactor - Handles global graph file compaction
 * 
 * Provides utilities to compact the global graph file by rewriting it
 * to eliminate redundancy and maintain performance.
 */
import { promises as fs } from 'fs';
import { join, dirname } from 'path';
import { logger } from '../utils/logger';
import { metrics } from '../metrics/metrics';

// Default compaction thresholds
const DEFAULT_COMPACT_THRESHOLD = 500;
const DEFAULT_COMPACT_MB_LIMIT = 20;

// Parse env vars with fallbacks to defaults
export const COMPACT_THRESHOLD = parseInt(process.env.COMPACT_THRESHOLD || `${DEFAULT_COMPACT_THRESHOLD}`, 10);
export const COMPACT_MB_LIMIT = parseInt(process.env.COMPACT_MB_LIMIT || `${DEFAULT_COMPACT_MB_LIMIT}`, 10);
export const MAX_GRAPH_MB = parseInt(process.env.MAX_GRAPH_MB || '100', 10);

/**
 * Interface for a compaction handler
 */
export interface Compactor {
  /**
   * Compact the global graph file if needed
   * @param graphPath Path to the global graph file
   * @param saveFunc Function to call to save the current in-memory graph
   * @param mergeCount Current merge count
   * @param force Whether to force compaction regardless of thresholds
   * @returns Promise resolving to whether compaction was performed
   */
  maybeCompact(
    graphPath: string,
    saveFunc: () => Promise<void>,
    mergeCount: number,
    force?: boolean
  ): Promise<boolean>;
  
  /**
   * Get the file size of the global graph in megabytes
   * @param graphPath Path to the global graph file
   * @returns Promise resolving to the file size in MB
   */
  getFileSizeMB(graphPath: string): Promise<number>;
  
  /**
   * Get the timestamp of the last compaction
   * @returns ISO timestamp string of the last compaction or null if never compacted
   */
  getLastCompactionTimestamp(): string | null;
}

/**
 * Default implementation of the compactor
 */
export class DefaultCompactor implements Compactor {
  // Timestamp of the last compaction
  private lastCompactionTime: Date | null = null;
  
  /**
   * Compact the global graph file if needed
   * @param graphPath Path to the global graph file
   * @param saveFunc Function to call to save the current in-memory graph
   * @param mergeCount Current merge count
   * @param force Whether to force compaction regardless of thresholds
   * @returns Promise resolving to whether compaction was performed
   */
  async maybeCompact(
    graphPath: string,
    saveFunc: () => Promise<void>,
    mergeCount: number,
    force: boolean = false
  ): Promise<boolean> {
    try {
      // Check if compaction is needed
      const fileSizeMB = await this.getFileSizeMB(graphPath);
      const needsCompact = mergeCount >= COMPACT_THRESHOLD || 
                          fileSizeMB >= COMPACT_MB_LIMIT ||
                          force;
      
      if (!needsCompact) {
        return false;
      }
      
      // Start timer for compaction metrics
      const startTime = Date.now();
      logger.info({
        graphPath,
        mergeCount,
        fileSizeMB,
        thresholdCount: COMPACT_THRESHOLD,
        thresholdMB: COMPACT_MB_LIMIT,
        force
      }, 'Starting global graph compaction');
      
      // Perform compaction by calling the provided save function
      // This will rewrite the entire file with deduplicated data
      await saveFunc();
      
      // Update metrics
      metrics.graphCompactionsTotal.inc();
      const duration = (Date.now() - startTime) / 1000; // convert to seconds
      metrics.graphCompactionTimeSeconds.observe(duration);
      
      // Update file size metric
      const newSizeMB = await this.getFileSizeMB(graphPath);
      metrics.globalGraphFileBytes.set(newSizeMB * 1024 * 1024); // convert MB to bytes
      
      // Update last compaction timestamp
      this.lastCompactionTime = new Date();
      
      logger.info({
        graphPath,
        durationMs: Date.now() - startTime,
        oldSizeMB: fileSizeMB,
        newSizeMB
      }, 'Global graph compaction completed');
      
      return true;
    } catch (err) {
      logger.error({ error: err, graphPath }, 'Error during graph compaction');
      return false;
    }
  }
  
  /**
   * Get the file size of the global graph in megabytes
   * @param graphPath Path to the global graph file
   * @returns Promise resolving to the file size in MB
   */
  async getFileSizeMB(graphPath: string): Promise<number> {
    try {
      const stats = await fs.stat(graphPath);
      return stats.size / (1024 * 1024); // bytes to MB
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        // File doesn't exist yet
        return 0;
      }
      logger.error({ error: err, graphPath }, 'Error getting file size');
      return 0;
    }
  }
  
  /**
   * Get the timestamp of the last compaction
   * @returns ISO timestamp string of the last compaction or null if never compacted
   */
  getLastCompactionTimestamp(): string | null {
    return this.lastCompactionTime ? this.lastCompactionTime.toISOString() : null;
  }
}

// Export a singleton instance
export const compactor = new DefaultCompactor();