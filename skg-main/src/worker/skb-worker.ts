/**
 * SKB Worker - Main service entry point
 *
 * This worker subscribes to new_note events, validates them,
 * generates knowledge graph fragments, and publishes acknowledgements.
 */
import { BrokerAdapter, MessageContext } from '../broker/adapter';
import { logger } from '../utils/logger';
import Config from '../config';
import { v4 as uuidv4 } from 'uuid';
import { NewNote } from '../types/new_note.v1';
import { NoteIndexed } from '../types/note_indexed.v1';
import { NoteFragmented } from '../types/note_fragmented.v1';
import {
  validateNewNoteMessage,
  SchemaValidationError,
  createPayloadTooLargeError,
  validateNoteFragmentedMessage
} from '../utils/schema-validator';
import { generateFragment } from '../kggen/generate';
import { startHealthServer } from '../health/server';
import { metrics } from '../metrics/metrics';
import { fragmentStore } from '../fragment-store';
import { graphStore } from '../graph-store';

// Max content size - 256 KiB
const MAX_CONTENT_SIZE_BYTES = 256 * 1024;

// Define async main function
export async function main(): Promise<void> {
  try {
    logger.info('Starting SKB worker...');

    // Initialize fragment store - load existing fragments from disk
    await fragmentStore.init();
    logger.info(`Loaded ${fragmentStore.size} fragments from disk`);

    // Set event cache size metric based on loaded fragments
    metrics.eventCacheSize.set(fragmentStore.size);

    // Initialize graph store - load or reconstruct the global graph
    await graphStore.init();
    logger.info({
      entities: graphStore.stats.entities,
      triples: graphStore.stats.triples,
      relations: graphStore.stats.relations
    }, 'Initialized global knowledge graph');

    // Set up the event emitter for the graph store
    graphStore.setEventEmitter(async (topic, data) => {
      await broker.publish(topic, data);
    });

    // Start the alias map watcher
    graphStore.startAliasWatcher();
    logger.info('Alias map watcher started');

    // Connect to the message broker
    const broker = await BrokerAdapter.connect(Config.broker.url);
    logger.info('Connected to broker');

    // Subscribe to the new_note topic
    await broker.subscribe<NewNote>(Config.topics.in.newNote, async (data, raw, context) => {
      // Start processing timer for metrics
      const timer = metrics.processingTime.startTimer();

      try {
        logger.debug({ data }, 'Received new_note event');

        // Track duplicate events
        if (context?.isDuplicate) {
          metrics.duplicatesDetected.inc();
          logger.info({
            noteId: data.note_id,
            eventId: data.event_id,
            originalTimestamp: context.originalTimestamp
          }, 'Duplicate event detected');
        }

        // Update metrics for event cache size
        if (broker instanceof BrokerAdapter && (broker as any).processedEvents) {
          const cacheSize = (broker as any).processedEvents.size || 0;
          metrics.eventCacheSize.set(cacheSize);
        }

        // Check content size before validation
        if (data.content && Buffer.byteLength(data.content, 'utf8') > MAX_CONTENT_SIZE_BYTES) {
          const contentSize = Buffer.byteLength(data.content, 'utf8');
          const error = createPayloadTooLargeError(contentSize, MAX_CONTENT_SIZE_BYTES);

          logger.warn({
            noteId: data.note_id,
            contentSize,
            maxSize: MAX_CONTENT_SIZE_BYTES
          }, 'Content too large');

          // Track validation error metric
          metrics.validationErrors.inc();
          metrics.notesProcessed.inc({ status: 'validation_failed' });

          // Send error ACK
          const correlationId = data.event_id || 'unknown';
          await sendErrorAck(broker, data.note_id, correlationId, 'VALIDATION_FAILED', error.message);
          return;
        }

        // Validate the new_note message
        const note = validateNewNoteMessage(data);
        logger.info({ noteId: note.note_id }, 'New note validated successfully');

        // Create and publish the acknowledgement
        const ack: NoteIndexed = {
          note_id: note.note_id,
          event_id: uuidv4(),
          correlation_id: note.event_id || 'unknown',
          status: 'RECEIVED',
          version: Config.service.version,
          timestamp: new Date().toISOString()
        };

        await broker.publish(Config.topics.out.noteIndexed, ack);
        logger.info({ noteId: note.note_id, status: 'RECEIVED' }, 'Published note_indexed ACK');

        // Track successful processing
        metrics.notesProcessed.inc({ status: 'received' });

        // Once note is validated, process it for knowledge graph fragment generation
        await processFragment(note, broker);

      } catch (error) {
        handleError(broker, error, data);
      } finally {
        // Stop the timer and observe the duration
        timer();
      }
    });
    
    logger.info({ topic: Config.topics.in.newNote }, 'SKB worker listening for events');

    // Start HTTP health-check server
    startHealthServer();
    
    // Set up graceful shutdown
    setupGracefulShutdown(broker);
    
  } catch (error) {
    logger.fatal({ error }, 'Failed to start SKB worker');
    process.exit(1);
  }
}

/**
 * Handle errors in event processing
 */
async function handleError(broker: BrokerAdapter, error: unknown, data: any): Promise<void> {
  try {
    const noteId = data?.note_id || 'unknown';
    const eventId = data?.event_id || 'unknown';

    if (error instanceof SchemaValidationError) {
      // Handle validation error
      logger.warn({
        noteId,
        error: error.message,
        validationErrors: error.errors
      }, 'Schema validation error');

      // Track validation error in metrics
      metrics.validationErrors.inc();
      metrics.notesProcessed.inc({ status: 'validation_failed' });

      // Send validation error ACK
      await sendErrorAck(broker, noteId, eventId, 'VALIDATION_FAILED', error.message);
    } else {
      // Handle runtime error
      logger.error({
        noteId,
        error
      }, 'Runtime error processing note');

      // Track runtime error in metrics
      metrics.notesProcessed.inc({ status: 'error' });

      // Send runtime error ACK
      const correlationId = typeof eventId === 'string' ? eventId : 'unknown';
      await sendErrorAck(broker, noteId, correlationId, 'INTERNAL_ERROR_M1', 'Internal server error');
    }
  } catch (ackError) {
    // This is really bad - couldn't even send the error ACK
    logger.error({ error: ackError }, 'Failed to send error ACK');
  }
}

/**
 * Process a validated note and generate a knowledge graph fragment
 */
async function processFragment(note: NewNote, broker: BrokerAdapter): Promise<void> {
  const noteId = note.note_id;
  const eventId = note.event_id || 'unknown';

  // Check if the fragment exists in memory - restart-safe
  if (fragmentStore.has(noteId)) {
    // Skip processing if the fragment already exists
    metrics.fragmentedSkipped.inc();
    logger.info({ noteId }, 'Fragment already exists, skipping generation');

    await publishFragmented(broker, {
      note_id: noteId,
      status: 'SKIPPED_DUPLICATE',
      entities: 0,
      relations: 0,
    }, eventId);

    return;
  }

  const start = Date.now();
  try {
    // Generate the fragment
    logger.info({ noteId }, 'Generating knowledge fragment');
    const fragment = await generateFragment(noteId, note.content);

    // Add to fragment store for future duplicate detection
    fragmentStore.add(noteId);

    // Update metrics
    metrics.fragmentsGenerated.inc();
    metrics.fragmentedSuccess.inc();
    metrics.processingTime.observe((Date.now() - start) / 1000);

    logger.info({
      noteId,
      entities: fragment.entities.length,
      relations: fragment.relations.length
    }, 'Fragment generation successful');

    // Merge the fragment into the global graph
    try {
      logger.info({ noteId }, 'Merging fragment into global knowledge graph');
      const mergeStats = await graphStore.merge_fragment(fragment);

      logger.info({
        noteId,
        addedEntities: mergeStats.addedEntities,
        mergedEntities: mergeStats.mergedEntities,
        addedTriples: mergeStats.addedTriples,
        conflicts: mergeStats.conflicts
      }, 'Fragment merged into global graph');
    } catch (err) {
      // Log error but continue - this shouldn't prevent sending the fragmented event
      logger.error({ error: err, noteId }, 'Error merging fragment into global graph');
    }

    // Publish the success message
    await publishFragmented(broker, {
      note_id: noteId,
      status: 'SUCCESS',
      entities: fragment.entities.length,
      relations: fragment.relations.length,
    }, eventId);
  } catch (err) {
    // Handle failures in fragment generation
    metrics.kggenFailures.inc();
    metrics.fragmentedError.inc();

    logger.error({
      error: err,
      noteId
    }, 'Knowledge fragment generation failed');

    await publishFragmented(broker, {
      note_id: noteId,
      status: 'ERROR_KGGEN',
      entities: 0,
      relations: 0,
    }, eventId);
  }
}

/**
 * Publish a note_fragmented event
 */
async function publishFragmented(
  broker: BrokerAdapter,
  body: {
    note_id: string;
    status: 'SUCCESS' | 'ERROR_KGGEN' | 'SKIPPED_DUPLICATE';
    entities: number;
    relations: number
  },
  correlationId: string,
): Promise<void> {
  const msg: NoteFragmented = {
    ...body,
    event_id: uuidv4(),
    correlation_id: correlationId,
    timestamp: new Date().toISOString()
  };

  // Validate the message
  validateNoteFragmentedMessage(msg);

  // Publish the message
  await broker.publish(Config.topics.out.noteFragmented, msg);

  logger.info({
    noteId: body.note_id,
    status: body.status,
    entities: body.entities,
    relations: body.relations
  }, 'Published note_fragmented event');
}

/**
 * Send an error acknowledgement
 */
async function sendErrorAck(
  broker: BrokerAdapter,
  noteId: string,
  correlationId: string,
  status: 'VALIDATION_FAILED' | 'INTERNAL_ERROR_M1',
  errorMsg: string
): Promise<void> {
  const ack: NoteIndexed = {
    note_id: noteId,
    event_id: uuidv4(),
    correlation_id: correlationId,
    status,
    version: Config.service.version,
    error_msg: errorMsg,
    timestamp: new Date().toISOString()
  };

  await broker.publish(Config.topics.out.noteIndexed, ack);
  logger.info({ noteId, status }, 'Published error ACK');
}

/**
 * Set up graceful shutdown handlers
 */
function setupGracefulShutdown(broker: BrokerAdapter): void {
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Received shutdown signal');

    try {
      // Stop alias map watcher
      logger.info('Stopping alias map watcher');
      graphStore.stopAliasWatcher();

      // Force a final compaction of the global graph to ensure all data is saved
      logger.info('Performing final graph compaction before shutdown');
      await graphStore.maybeCompact(true);
      logger.info('Final graph compaction completed');

      // Close broker connection
      await broker.close();
      logger.info('Broker connection closed');

      // Exit the process
      process.exit(0);
    } catch (error) {
      logger.error({ error }, 'Error during shutdown');
      process.exit(1);
    }
  };
  
  // Listen for termination signals
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Handle SIGHUP for alias map reload
  process.on('SIGHUP', async () => {
    logger.info('Received SIGHUP signal, reloading alias map');
    try {
      const reloaded = await graphStore.reloadAliasMap();
      if (reloaded) {
        logger.info('Alias map reloaded successfully on SIGHUP');
      } else {
        logger.warn('Alias map reload was skipped or failed on SIGHUP');
      }
    } catch (error) {
      logger.error({ error }, 'Error handling SIGHUP for alias map reload');
    }
  });

  // Handle uncaught exceptions and rejections
  process.on('uncaughtException', (error) => {
    logger.fatal({ error }, 'Uncaught exception');
    shutdown('uncaughtException');
  });

  process.on('unhandledRejection', (reason, promise) => {
    logger.fatal({ reason, promise }, 'Unhandled rejection');
    shutdown('unhandledRejection');
  });
}

// Start the worker if this is the main module
if (require.main === module) {
  main().catch((error) => {
    logger.fatal({ error }, 'Fatal error in SKB worker');
    process.exit(1);
  });
}

export default main;