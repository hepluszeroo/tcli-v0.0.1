/**
 * Graph Store - Manages the global knowledge graph
 *
 * Provides a persistent, consolidated knowledge graph by merging
 * individual fragments and handling entity deduplication.
 */
import { join, dirname } from 'path';
import { promises as fs, watchFile, unwatchFile } from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { KnowledgeFragment } from '../types/knowledge_fragment.v1';
import { GraphUpdated } from '../types/graph_updated.v1';
import { metrics } from '../metrics/metrics';
import { logger } from '../utils/logger';
import Config from '../config';
import { compactor, COMPACT_THRESHOLD, COMPACT_MB_LIMIT } from './compactor';

// Type definitions for the global graph
interface GraphEntity {
  id: string;
  label: string;
  type: string;
  normalizedLabel?: string; // For search/matching
  sources?: string[]; // note_ids where this entity appears
}

interface GraphTriple {
  subject: string;
  predicate: string;
  object: string;
  sources?: string[]; // note_ids where this triple appears
}

interface AliasMap {
  [key: string]: string; // normalized alias -> canonical form
}

export class GraphStore {
  // In-memory representation of the graph
  private entities: Map<string, GraphEntity> = new Map();
  private triples: GraphTriple[] = [];
  private relations: Set<string> = new Set();

  // Entity deduplication
  private normalizedEntities: Map<string, string> = new Map(); // normalized label -> entity id
  private aliasMap: AliasMap = {};

  // Delta tracking for incremental appends
  private delta = { entities: [] as GraphEntity[], triples: [] as GraphTriple[] };

  // Mutex for append operations
  private appendMutex = false;

  // Mutex for compaction operations
  private compactRunning = false;

  // Mutex for alias map reloading
  private aliasMapReloading = false;

  // Alias map watcher state
  private aliasWatcherActive = false;
  private aliasWatcherDebounceTimer: NodeJS.Timeout | null = null;
  private lastAliasMapReloadTime: Date | null = null;
  private lastAliasMapReload = 0; // epoch-ms
  private aliasMapErrorCount = 0;

  // Counters for metrics
  private mergeCount: number = 0;

  // Last compaction timestamp
  private lastCompactionTime: Date | null = null;
  private lastCompaction = 0; // epoch-ms
  
  /**
   * Create a new graph store
   * @param graphPath Path to the global graph file
   * @param aliasMapPath Path to the alias map file
   * @param fragmentDir Directory containing fragment files (for recovery)
   */
  constructor(
    /*
     * The default locations point to a writable folder inside the project
     * directory so that local development and CI (which usually do **not**
     * run as root) work out-of-the-box. Production / container deployments
     * can override these via environment variables to keep using
     * `/data/skb/...` as originally designed.
     */
    private graphPath = process.env.GLOBAL_GRAPH_PATH || join(process.cwd(), 'data', 'skb', 'global_graph.json'),
    private aliasMapPath = process.env.ALIAS_MAP_PATH || join(process.cwd(), 'data', 'skb', 'alias_map.yml'),
    private fragmentDir = process.env.FRAGMENT_DIR || join(process.cwd(), 'data', 'skb', 'graph_fragments')
  ) {}
  
  /**
   * Initialize the graph store by loading the global graph or reconstructing it
   */
  async init(): Promise<void> {
    try {
      logger.info({ path: this.graphPath }, 'Initializing graph store');
      
      // Load alias map for entity normalization
      await this.loadAliasMap();
      
      // Try to load the global graph file
      try {
        await this.loadGlobalGraph();
      } catch (err: any) {
        if (err.code === 'ENOENT') {
          // Global graph doesn't exist, reconstruct from fragments
          logger.info('Global graph not found, reconstructing from fragments');
          await this.reconstructFromFragments();
        } else {
          // Other error, attempt reconstruction
          logger.error({ error: err }, 'Error loading global graph, attempting reconstruction');
          await this.reconstructFromFragments();
        }
      }
      
      // Update metrics
      this.updateMetrics();
      
      logger.info({ 
        entities: this.entities.size,
        triples: this.triples.length,
        relations: this.relations.size
      }, 'Graph store initialized');
      
    } catch (err) {
      logger.error({ error: err }, 'Error initializing graph store');
      throw err;
    }
  }
  
  /**
   * Load the alias map for entity normalization
   */
  private async loadAliasMap(): Promise<void> {
    try {
      // Ensure parent directory exists
      await fs.mkdir(dirname(this.aliasMapPath), { recursive: true });
      
      // Check if alias map exists
      try {
        const aliasData = await fs.readFile(this.aliasMapPath, 'utf8');
        // Very lightweight YAML parsing: each line "key: value" -> alias mapping.
        // This is sufficient for the simple one-liner maps used in tests and
        // avoids pulling an extra YAML dependency into the build.
        this.aliasMap = aliasData
          .split(/\r?\n/)               // split into lines
          .map(l => l.trim())            // trim whitespace
          .filter(l => l && !l.startsWith('#')) // drop comments / blank lines
          .reduce<AliasMap>((acc, line) => {
            const idx = line.indexOf(':');
            if (idx === -1) return acc;
            const key = line.slice(0, idx).trim();
            const val = line.slice(idx + 1).trim();
            if (key && val) acc[key] = val;
            return acc;
          }, {});
        const aliasCount = Object.keys(this.aliasMap).length;
        logger.info({ aliases: aliasCount }, 'Loaded alias map');

        // Update metrics
        metrics.aliasMapSize.set(aliasCount);
      } catch (err: any) {
        if (err.code === 'ENOENT') {
          // Create an empty alias map if it doesn't exist
          this.aliasMap = {};
          // Write an empty alias map file so that future runs recognise it
          await fs.writeFile(this.aliasMapPath, '', 'utf8');
          logger.info('Created empty alias map');

          // Update metrics
          metrics.aliasMapSize.set(0);
        } else {
          throw err;
        }
      }
    } catch (err) {
      logger.warn({ error: err }, 'Error loading alias map, continuing without aliases');
      this.aliasMap = {};

      // Update metrics
      metrics.aliasMapSize.set(0);
    }
  }
  
  /**
   * Load the global graph from disk
   */
  private async loadGlobalGraph(): Promise<void> {
    const data = await fs.readFile(this.graphPath, 'utf8');
    const lines = data.trim().split('\n');
    
    if (lines.length === 0) {
      throw new Error('Global graph file is empty');
    }
    
    // Clear existing in-memory data
    this.entities.clear();
    this.triples = [];
    this.relations.clear();
    this.normalizedEntities.clear();
    
    // Process each line (JSON-Lines format)
    for (const line of lines) {
      try {
        const record = JSON.parse(line);
        
        if (record.type === 'entity') {
          const entity: GraphEntity = record.data;
          this.entities.set(entity.id, entity);
          
          // Index normalized label for lookup
          if (entity.normalizedLabel) {
            this.normalizedEntities.set(entity.normalizedLabel, entity.id);
          }
        } else if (record.type === 'triple') {
          const triple: GraphTriple = record.data;
          this.triples.push(triple);
          this.relations.add(triple.predicate);
        }
      } catch (err) {
        logger.warn({ error: err, line }, 'Error parsing global graph line, skipping');
      }
    }
    
    logger.info({ 
      entities: this.entities.size,
      triples: this.triples.length,
      relations: this.relations.size
    }, 'Loaded global graph from disk');
  }
  
  /**
   * Reconstruct the global graph from individual fragments
   */
  private async reconstructFromFragments(): Promise<void> {
    try {
      logger.info({ dir: this.fragmentDir }, 'Reconstructing global graph from fragments');
      
      // Clear existing in-memory data
      this.entities.clear();
      this.triples = [];
      this.relations.clear();
      this.normalizedEntities.clear();
      
      // Create the global graph directory if it doesn't exist
      await fs.mkdir(dirname(this.graphPath), { recursive: true });
      
      // Read all fragment files
      const files = await fs.readdir(this.fragmentDir);
      const jsonFiles = files.filter(f => f.endsWith('.json'));
      
      logger.info({ count: jsonFiles.length }, 'Found fragment files for reconstruction');
      
      // Process each fragment
      for (const file of jsonFiles) {
        try {
          const raw = await fs.readFile(join(this.fragmentDir, file), 'utf8');
          const fragment = JSON.parse(raw) as KnowledgeFragment;
          
          if (fragment.note_id) {
            // Merge the fragment into the global graph
            await this.merge_fragment(fragment, false);
            logger.debug({ noteId: fragment.note_id }, 'Merged fragment during reconstruction');
          } else {
            logger.warn({ file }, 'Fragment missing note_id, skipping');
          }
        } catch (err) {
          logger.warn({ file, error: err }, 'Error processing fragment file during reconstruction');
          // Continue with other files even if one fails
        }
      }
      
      // Write the reconstructed graph to disk
      await this.saveGlobalGraph();
      
      logger.info({ 
        entities: this.entities.size,
        triples: this.triples.length,
        relations: this.relations.size
      }, 'Global graph reconstructed from fragments');
      
    } catch (err) {
      logger.error({ error: err }, 'Failed to reconstruct global graph');
      throw err;
    }
  }
  
  /**
   * Save the current global graph to disk (full rewrite)
   *
   * @internal This method is only used during initialization and by the compactor.
   * Normal graph updates should use appendDeltas() instead.
   */
  private async saveGlobalGraph(): Promise<void> {
    try {
      // Ensure parent directory exists
      await fs.mkdir(dirname(this.graphPath), { recursive: true });

      // Create output stream for appending lines
      const tempPath = `${this.graphPath}.new`;

      // Start with empty file
      await fs.writeFile(tempPath, '', 'utf8');

      // Write all entities
      for (const entity of this.entities.values()) {
        const line = JSON.stringify({
          type: 'entity',
          data: entity
        }) + '\n';
        await fs.appendFile(tempPath, line, 'utf8');
      }

      // Write all triples
      for (const triple of this.triples) {
        const line = JSON.stringify({
          type: 'triple',
          data: triple
        }) + '\n';
        await fs.appendFile(tempPath, line, 'utf8');
      }

      // Atomically replace the old file with the new one
      await fs.rename(tempPath, this.graphPath);

      logger.info({ path: this.graphPath }, 'Saved global graph to disk');
    } catch (err) {
      logger.error({ error: err }, 'Error saving global graph');
      throw err;
    }
  }
  
  /**
   * Normalize a string for entity matching
   * Performs case folding, whitespace normalization, and basic stopword removal
   * @param label The label to normalize
   * @returns Normalized label
   */
  private normalizeLabel(label: string): string {
    if (!label) return '';

    // Convert to lowercase
    let normalized = label.toLowerCase();

    // Trim whitespace and normalize internal spaces
    normalized = normalized.trim().replace(/\s+/g, ' ');

    // Remove common stop words
    const stopWords = ['a', 'an', 'the', 'and', 'or', 'but', 'of', 'for', 'in', 'on', 'at', 'to'];
    let words = normalized.split(' ');
    words = words.filter(word => !stopWords.includes(word));
    normalized = words.join(' ');

    return normalized;
  }

  /**
   * Resolve entity aliases using the alias map
   * @param normalizedLabel The normalized label to resolve
   * @returns The canonical form or the original if no alias exists
   */
  private resolveAlias(normalizedLabel: string): string {
    const aliasValue = this.aliasMap[normalizedLabel];

    // If we found an alias, track metrics and return the canonical form
    if (aliasValue) {
      metrics.aliasHitsTotal.inc();
      return aliasValue;
    }

    // Otherwise return the original
    return normalizedLabel;
  }

  /**
   * Find existing entity by normalized label
   * @param normalizedLabel The normalized label to lookup
   * @returns Entity ID if found, undefined otherwise
   */
  private findEntityByNormalizedLabel(normalizedLabel: string): string | undefined {
    // Check alias resolution first
    const resolvedLabel = this.resolveAlias(normalizedLabel);

    // Check if we have this label indexed
    return this.normalizedEntities.get(resolvedLabel);
  }

  /**
   * Merge a fragment into the global graph
   * @param fragment The fragment to merge
   * @param save Whether to save the updated graph to disk (default: true)
   * @returns Object containing merge statistics
   */
  async merge_fragment(fragment: KnowledgeFragment, save: boolean = true): Promise<{
    addedEntities: number;
    mergedEntities: number;
    addedTriples: number;
    conflicts: number;
  }> {
    // Start metrics
    const startTime = Date.now();
    const stats = {
      addedEntities: 0,
      mergedEntities: 0,
      addedTriples: 0,
      conflicts: 0
    };

    // Start timer for merge operation metrics
    const mergeTimer = metrics.fragmentMergeTime.startTimer();

    try {
      logger.debug({ noteId: fragment.note_id }, 'Merging fragment into global graph');

      // Create mapping from fragment entity IDs to global entity IDs
      const entityMapping: Map<string, string> = new Map();

      // Process each entity in the fragment
      for (const entity of fragment.entities) {
        // Normalize the label for matching
        const normalizedLabel = this.normalizeLabel(entity.label);

        // Check if entity already exists in the global graph by normalized label
        const existingEntityId = this.findEntityByNormalizedLabel(normalizedLabel);

        if (existingEntityId) {
          // Entity already exists, merge attributes
          const existingEntity = this.entities.get(existingEntityId)!;

          // Add the note_id to the sources if it doesn't exist
          if (!existingEntity.sources) {
            existingEntity.sources = [];
          }
          if (!existingEntity.sources.includes(fragment.note_id)) {
            existingEntity.sources.push(fragment.note_id);
          }

          // Map fragment entity ID to global entity ID
          entityMapping.set(entity.id, existingEntityId);
          stats.mergedEntities++;

          logger.debug({
            fragmentEntityId: entity.id,
            globalEntityId: existingEntityId,
            label: entity.label
          }, 'Merged entity with existing entity');
        } else {
          // This is a new entity, add it to the global graph
          const globalEntityId = `g${this.entities.size + 1}`;

          const globalEntity: GraphEntity = {
            id: globalEntityId,
            label: entity.label,
            type: entity.type,
            normalizedLabel: normalizedLabel,
            sources: [fragment.note_id]
          };

          // Add to global entities
          this.entities.set(globalEntityId, globalEntity);

          // Add to delta for incremental append
          this.delta.entities.push(globalEntity);

          // Index normalized label for future lookups
          this.normalizedEntities.set(normalizedLabel, globalEntityId);

          // Map fragment entity ID to global entity ID
          entityMapping.set(entity.id, globalEntityId);
          stats.addedEntities++;

          logger.debug({
            fragmentEntityId: entity.id,
            globalEntityId: globalEntityId,
            label: entity.label
          }, 'Added new entity to global graph');
        }
      }

      // Process relation types
      for (const relation of fragment.relations) {
        this.relations.add(relation);
      }

      // Process triples
      for (const triple of fragment.triples) {
        // Map subject and object to global entity IDs
        const globalSubjectId = entityMapping.get(triple.subject);
        const globalObjectId = entityMapping.get(triple.object);

        // Skip if we couldn't map either the subject or object
        if (!globalSubjectId || !globalObjectId) {
          logger.warn({
            triple,
            noteId: fragment.note_id,
            hasSubject: !!globalSubjectId,
            hasObject: !!globalObjectId
          }, 'Skipping triple due to missing entity mapping');

          stats.conflicts++;
          metrics.mergeConflictsTotal.inc();
          continue;
        }

        // Check if this triple already exists in the global graph
        const existingTripleIndex = this.triples.findIndex(t =>
          t.subject === globalSubjectId &&
          t.predicate === triple.predicate &&
          t.object === globalObjectId
        );

        if (existingTripleIndex !== -1) {
          // Triple exists, just add the note_id to sources
          const existingTriple = this.triples[existingTripleIndex];

          if (!existingTriple.sources) {
            existingTriple.sources = [];
          }

          if (!existingTriple.sources.includes(fragment.note_id)) {
            existingTriple.sources.push(fragment.note_id);
          }

          logger.debug({
            subject: globalSubjectId,
            predicate: triple.predicate,
            object: globalObjectId
          }, 'Updated existing triple sources');
        } else {
          // Add new triple to global graph
          const globalTriple: GraphTriple = {
            subject: globalSubjectId,
            predicate: triple.predicate,
            object: globalObjectId,
            sources: [fragment.note_id]
          };

          this.triples.push(globalTriple);
          // Add to delta for incremental append
          this.delta.triples.push(globalTriple);
          stats.addedTriples++;

          logger.debug({
            subject: globalSubjectId,
            predicate: triple.predicate,
            object: globalObjectId
          }, 'Added new triple to global graph');
        }
      }

      // Increment merge counter for potential compaction
      this.mergeCount++;

      // Update metrics
      this.updateMetrics();

      // Emit graph_updated event and wait for completion so that callers
      // (especially the test-suite and any upstream workflow that relies on
      //  the event having been published) can safely act after this function
      //  resolves.
      await this.emitGraphUpdated(fragment.note_id, stats);

      // Save to disk if requested - after event emission for data durability
      if (save) {
        await this.appendDeltas();
      }

      // Increment merge counter for compaction
      this.mergeCount++;

      // Check if compaction is needed
      this.maybeCompact();

      // Record duration in milliseconds
      const duration = Date.now() - startTime;

      // Stop the histogram timer
      mergeTimer();
      logger.info({
        noteId: fragment.note_id,
        duration,
        stats
      }, 'Successfully merged fragment into global graph');

      return stats;
    } catch (error) {
      logger.error({
        noteId: fragment.note_id,
        error
      }, 'Error merging fragment into global graph');

      throw error;
    }
  }

  /**
   * Append deltas (new entities and triples) to the global graph file
   * @returns Promise resolving when the append operation is complete
   */
  private async appendDeltas(): Promise<void> {
    if (!this.delta.entities.length && !this.delta.triples.length) return;

    // Check if another append operation is in progress
    if (this.appendMutex) {
      logger.warn('Append operation already in progress, waiting...');
      // Wait for mutex to be released
      await new Promise(resolve => {
        const checkInterval = setInterval(() => {
          if (!this.appendMutex) {
            clearInterval(checkInterval);
            resolve(true);
          }
        }, 100);
      });
    }

    // Acquire mutex
    this.appendMutex = true;

    try {
      // Ensure parent directory exists
      await fs.mkdir(dirname(this.graphPath), { recursive: true });

      const fd = await fs.open(this.graphPath, 'a');
      try {
        // Write all new entities
        for (const entity of this.delta.entities) {
          await fd.appendFile(JSON.stringify({ type: 'entity', data: entity }) + '\n');
        }

        // Write all new triples
        for (const triple of this.delta.triples) {
          await fd.appendFile(JSON.stringify({ type: 'triple', data: triple }) + '\n');
        }

        // Sync to disk only if FSYNC=true for performance
        if (process.env.FSYNC === 'true') {
          await fd.sync();
          logger.debug('Performed fsync on global graph file');
        }

        logger.debug({
          entities: this.delta.entities.length,
          triples: this.delta.triples.length
        }, 'Appended deltas to global graph file');

        // Update file size metric after append
        const fileSize = await this.getFileSizeMB();
        metrics.globalGraphFileBytes.set(fileSize * 1024 * 1024); // MB to bytes
      } finally {
        await fd.close();
        // Reset delta tracking
        this.delta = { entities: [], triples: [] };
        // Release mutex
        this.appendMutex = false;
      }
    } catch (err) {
      // Release mutex even if an error occurs
      this.appendMutex = false;
      logger.error({ error: err }, 'Error appending deltas to global graph');
      throw err;
    }
  }

  /**
   * Legacy method for appending changes - now calls appendDeltas
   * @param noteId ID of the note that was merged
   * @param stats Merge statistics
   */
  private async appendToGlobalGraph(noteId: string, stats: any): Promise<void> {
    try {
      await this.appendDeltas();
      logger.debug({ noteId, stats }, 'Appended changes to global graph');
    } catch (err) {
      logger.error({ noteId, error: err }, 'Error appending to global graph');
      throw err;
    }
  }

  /**
   * Event emitter for graph updates
   * Function that will be set externally to allow event emission
   */
  private eventEmitter: ((topic: string, data: any) => Promise<void>) | null = null;

  /**
   * Set the event emitter function
   * This allows the worker to inject the broker's publish method
   * @param emitter Function to call when emitting events
   */
  setEventEmitter(emitter: (topic: string, data: any) => Promise<void>): void {
    this.eventEmitter = emitter;
    logger.info('Graph store event emitter has been set');
  }

  /**
   * Emit a graph_updated event
   * @param noteId ID of the note that triggered the update
   * @param stats Update statistics
   */
  private async emitGraphUpdated(noteId: string, stats: any): Promise<void> {
    if (!this.eventEmitter) {
      logger.warn('Cannot emit graph_updated event: no event emitter set');
      return;
    }

    // nothing

    try {
      // Prepare the graph_updated event
      const event: GraphUpdated = {
        event_id: uuidv4(),
        correlation_id: noteId, // Using noteId as correlation for now
        note_id: noteId,
        timestamp: new Date().toISOString(),
        total_entities: this.entities.size,
        total_triples: this.triples.length,
        added_entities: stats.addedEntities,
        merged_entities: stats.mergedEntities,
        added_triples: stats.addedTriples,
        conflicts: stats.conflicts
      };

      // Resolve topic names with sane fallbacks in case Config is mocked or
      // partially initialised (as happens in some unit tests).
      const internalTopic = (Config?.topics as any)?.internal?.graphUpdated || 'internal.skb.graph.updated.v1';
      const externalTopic = (Config?.topics as any)?.out?.graphUpdated || 'events.skb.graph.updated.v1';

      // Emit internal event - this can be used for intra-service communication
      await this.eventEmitter(internalTopic, event);
      logger.debug({ noteId, stats }, 'Emitted internal graph_updated event');

      // Emit external event - this can be consumed by other services
      await this.eventEmitter(externalTopic, event);
      logger.info({ noteId, stats }, 'Published graph_updated event');
    } catch (err) {
      logger.error({ error: err, noteId }, 'Failed to emit graph_updated event');
      // If emitting fails we just log (already mocked in tests).
    }
  }
  
  /**
   * Update metrics based on current graph state
   */
  private updateMetrics(): void {
    // Update graph structure metrics
    metrics.graphNodesTotal.set(this.entities.size);
    metrics.graphEdgesTotal.set(this.triples.length);

    // Update graph updates counter (called each time the graph is modified)
    metrics.graphUpdatesTotal.inc();
  }
  
  /**
   * Maybe compact the global graph file
   * @param force Whether to force compaction regardless of thresholds
   * @returns Promise resolving to whether compaction was performed
   */
  async maybeCompact(force: boolean = false): Promise<boolean> {
    // Skip if compaction is already running
    if (this.compactRunning) {
      logger.debug('Compaction already in progress, skipping');
      return false;
    }

    // Check if compaction is needed
    const needs = force ||
                this.mergeCount >= COMPACT_THRESHOLD ||
                (await this.getFileSizeMB()) >= COMPACT_MB_LIMIT;

    if (!needs) {
      return false;
    }

    // Acquire mutex
    this.compactRunning = true;
    const start = Date.now();

    try {
      logger.info({
        mergeCount: this.mergeCount,
        fileSizeMB: await this.getFileSizeMB(),
        force
      }, 'Starting global graph compaction');

      // Perform the actual compaction
      await this.saveGlobalGraph();

      // Reset the merge counter
      this.mergeCount = 0;

      // Clear delta tracking
      this.delta = { entities: [], triples: [] };

      // Update file size metric
      const newSizeMB = await this.getFileSizeMB();
      metrics.globalGraphFileBytes.set(newSizeMB * 1024 * 1024); // MB to bytes

      logger.info('Global graph compaction completed successfully');
      return true;
    } catch (err) {
      logger.error({ error: err }, 'Error during graph compaction');
      return false;
    } finally {
      // Release mutex
      this.compactRunning = false;

      // Update timestamps
      this.lastCompactionTime = new Date();
      this.lastCompaction = Date.now();

      // Update metrics
      metrics.graphCompactionTimeSeconds.observe((Date.now() - start) / 1000);
      metrics.graphCompactionsTotal.inc();
    }
  }

  /**
   * Get the file size of the global graph in megabytes
   * @returns Promise resolving to the file size in MB
   */
  async getFileSizeMB(): Promise<number> {
    return compactor.getFileSizeMB(this.graphPath);
  }

  /**
   * Get the timestamp of the last compaction
   * @returns ISO timestamp string of the last compaction or null if never compacted
   */
  getLastCompactionTimestamp(): string | null {
    return this.lastCompactionTime ? this.lastCompactionTime.toISOString() : null;
  }

  /**
   * Reload the alias map from disk
   * This is typically called in response to a SIGHUP signal or file watcher
   * @returns Promise resolving to whether reload was successful
   */
  async reloadAliasMap(): Promise<boolean> {
    // Skip if reload is already in progress
    if (this.aliasMapReloading) {
      logger.debug('Alias map reload already in progress, skipping');
      return false;
    }

    // Acquire mutex
    this.aliasMapReloading = true;
    const start = Date.now();

    try {
      logger.info({ path: this.aliasMapPath }, 'Reloading alias map');

      // Store the previous alias map count for logging
      const prevAliasCount = Object.keys(this.aliasMap).length;

      // Load the new alias map
      await this.loadAliasMap();

      // Get the new count
      const newAliasCount = Object.keys(this.aliasMap).length;

      // Update timestamps
      this.lastAliasMapReloadTime = new Date();
      this.lastAliasMapReload = Date.now();

      logger.info({
        path: this.aliasMapPath,
        prevCount: prevAliasCount,
        newCount: newAliasCount,
        delta: newAliasCount - prevAliasCount
      }, 'Alias map reloaded successfully');

      // Update metrics
      metrics.aliasMapReloadsTotal.inc();

      // Emit alias updated event if we have an event emitter
      if (this.eventEmitter) {
        const event = {
          event_id: uuidv4(),
          timestamp: new Date().toISOString(),
          previous_count: prevAliasCount,
          current_count: newAliasCount,
          delta: newAliasCount - prevAliasCount,
          file_path: this.aliasMapPath
        };

        try {
          const internalTopic = (Config?.topics as any)?.internal?.aliasUpdated || 'internal.skb.alias.updated.v1';
          await this.eventEmitter(internalTopic, event);
          logger.debug('Emitted internal alias_updated event');
        } catch (eventErr) {
          logger.warn({ error: eventErr }, 'Failed to emit alias_updated event');
        }
      }

      return true;
    } catch (err) {
      logger.error({ error: err }, 'Error reloading alias map');

      // Increment error counter
      this.aliasMapErrorCount++;

      // Update metrics for errors
      metrics.aliasMapReloadErrorsTotal.inc();

      return false;
    } finally {
      // Release mutex
      this.aliasMapReloading = false;

      // Update metrics
      const duration = (Date.now() - start) / 1000; // convert to seconds
      metrics.aliasMapReloadTimeSeconds.observe(duration);
    }
  }

  /**
   * Start watching the alias map file for changes
   * @returns True if the watcher was started, false if it was already running
   */
  startAliasWatcher(): boolean {
    if (this.aliasWatcherActive) {
      logger.debug('Alias map watcher already running');
      return false;
    }

    const DEBOUNCE_MS = 500; // Debounce multiple file changes within 500ms

    try {
      // Set up the file watcher
      watchFile(this.aliasMapPath, { interval: 5000 }, async (curr, prev) => {
        // Skip if nothing changed or file is being written to (size=0)
        if (curr.mtime.getTime() === prev.mtime.getTime() || curr.size === 0) {
          return;
        }

        logger.debug({
          path: this.aliasMapPath,
          currentMtime: curr.mtime,
          previousMtime: prev.mtime
        }, 'Alias map file changed');

        // Debounce multiple changes
        if (this.aliasWatcherDebounceTimer) {
          clearTimeout(this.aliasWatcherDebounceTimer);
        }

        this.aliasWatcherDebounceTimer = setTimeout(async () => {
          logger.info({ path: this.aliasMapPath }, 'Alias map change detected, reloading');
          try {
            const success = await this.reloadAliasMap();
            if (success) {
              logger.info('Alias map reloaded automatically');
            } else {
              logger.warn('Alias map reload was skipped or failed');
            }
          } catch (err) {
            logger.error({ error: err }, 'Error during automatic alias map reload');
          }
          this.aliasWatcherDebounceTimer = null;
        }, DEBOUNCE_MS);
      });

      this.aliasWatcherActive = true;
      logger.info({ path: this.aliasMapPath }, 'Started alias map file watcher');
      return true;
    } catch (err) {
      logger.error({ error: err }, 'Failed to start alias map file watcher');
      return false;
    }
  }

  /**
   * Stop watching the alias map file
   * @returns True if the watcher was stopped, false if it wasn't running
   */
  stopAliasWatcher(): boolean {
    if (!this.aliasWatcherActive) {
      return false;
    }

    try {
      // Clear any pending reload
      if (this.aliasWatcherDebounceTimer) {
        clearTimeout(this.aliasWatcherDebounceTimer);
        this.aliasWatcherDebounceTimer = null;
      }

      // Stop watching the file
      unwatchFile(this.aliasMapPath);
      this.aliasWatcherActive = false;
      logger.info({ path: this.aliasMapPath }, 'Stopped alias map file watcher');
      return true;
    } catch (err) {
      logger.error({ error: err }, 'Error stopping alias map file watcher');
      return false;
    }
  }

  /**
   * Get the timestamp of the last alias map reload
   * @returns ISO timestamp string of the last reload or null if never reloaded
   */
  getLastAliasMapReloadTimestamp(): string | null {
    return this.lastAliasMapReloadTime ? this.lastAliasMapReloadTime.toISOString() : null;
  }

  /**
   * Get alias map statistics
   */
  get aliasStats() {
    return {
      entries: Object.keys(this.aliasMap).length,
      lastReload: this.getLastAliasMapReloadTimestamp(),
      lastReloadMs: this.lastAliasMapReload,
      errorCount: this.aliasMapErrorCount
    };
  }

  /**
   * Get graph statistics
   */
  get stats() {
    return {
      entities: this.entities.size,
      triples: this.triples.length,
      relations: this.relations.size,
      mergeCount: this.mergeCount,
      lastCompaction: this.getLastCompactionTimestamp(),
      lastCompactionMs: this.lastCompaction,
      aliasMapEntries: Object.keys(this.aliasMap).length
    };
  }
}

// Singleton instance for use throughout the application
export const graphStore = new GraphStore();