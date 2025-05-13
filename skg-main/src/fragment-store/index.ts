/**
 * Fragment Store - Manages knowledge graph fragment tracking
 * 
 * Provides persistent tracking of processed note IDs across service restarts
 * by loading existing fragments from disk at startup.
 */
import { join } from 'path';
import { promises as fs } from 'fs';
import { KnowledgeFragment } from '../types/knowledge_fragment.v1';
import { metrics } from '../metrics/metrics';
import { logger } from '../utils/logger';

export class FragmentStore {
  /** Set of processed note IDs */
  private processed = new Set<string>();

  /**
   * Create a new fragment store
   * @param dir Directory where fragments are stored
   */
  constructor(private dir = process.env.FRAGMENT_DIR || '/data/skb/graph_fragments') {}

  /**
   * Initialize the store by scanning fragments on disk
   * Only needs to be called once at service startup
   */
  async init(): Promise<void> {
    try {
      logger.info({ dir: this.dir }, 'Initializing fragment store');
      
      // Ensure the directory exists
      await fs.mkdir(this.dir, { recursive: true });
      
      // Read all files in the directory
      const files = await fs.readdir(this.dir);
      
      // Filter for JSON files
      const jsonFiles = files.filter(f => f.endsWith('.json'));
      logger.debug({ count: jsonFiles.length }, 'Found fragment files');
      
      // Process each fragment file
      for (const file of jsonFiles) {
        try {
          const raw = await fs.readFile(join(this.dir, file), 'utf8');
          const frag = JSON.parse(raw) as KnowledgeFragment;
          
          if (frag.note_id) {
            this.processed.add(frag.note_id);
            logger.debug({ noteId: frag.note_id }, 'Loaded fragment');
          } else {
            logger.warn({ file }, 'Fragment missing note_id, skipping');
          }
        } catch (err) {
          logger.warn({ file, error: err }, 'Error processing fragment file');
          // Continue with other files even if one fails
        }
      }
      
      // Update metrics
      metrics.fragmentsLoaded.set(this.size);
      logger.info({ loaded: this.size }, 'Loaded fragments from disk');
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        // Directory doesn't exist yet, create it
        await fs.mkdir(this.dir, { recursive: true });
        logger.info({ dir: this.dir }, 'Created fragment directory');
      } else {
        // Other error occurred
        logger.error({ err }, 'Error loading fragments');
        throw err;
      }
    }
  }

  /**
   * Get the number of processed fragments
   */
  get size(): number {
    return this.processed.size;
  }
  
  /**
   * Check if a note has already been processed
   * @param noteId ID of the note to check
   */
  has(noteId: string): boolean {
    return this.processed.has(noteId);
  }
  
  /**
   * Add a note ID to the processed set
   * @param noteId ID of the note to mark as processed
   */
  add(noteId: string): void {
    this.processed.add(noteId);
    // Update the metric whenever we add a new fragment
    metrics.eventCacheSize.set(this.size);
  }
}

// Singleton instance for use throughout the application
export const fragmentStore = new FragmentStore();