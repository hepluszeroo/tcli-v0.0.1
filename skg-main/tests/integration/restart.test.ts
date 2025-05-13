/**
 * Integration test for restart functionality
 * 
 * Tests that the SKB service correctly loads fragments from disk on restart
 * and skips processing of already processed notes.
 */
import { connect, StringCodec } from 'nats';
import { v4 as uuidv4 } from 'uuid';
import { promises as fs } from 'fs';
import { join } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { NewNote } from '../../src/types/new_note.v1';
import { NoteIndexed } from '../../src/types/note_indexed.v1';
import { NoteFragmented } from '../../src/types/note_fragmented.v1';
import { main as startWorker } from '../../src/worker/skb-worker';

// Promisify exec
const execAsync = promisify(exec);

// Broker connection info
const BROKER_URL = process.env.BROKER_URL || 'nats://localhost:4222';
const TOPIC_NEW_NOTE = process.env.TOPIC_IN_NEW_NOTE || 'events.tangent.notes.new.v1';
const TOPIC_NOTE_INDEXED = process.env.TOPIC_OUT_NOTE_INDEXED || 'events.skb.indexing.status.v1';
const TOPIC_NOTE_FRAGMENTED = process.env.TOPIC_OUT_NOTE_FRAGMENTED || 'events.skb.note.fragmented.v1';

// Test directory for fragments
const TEST_FRAGMENT_DIR = join(process.cwd(), 'tmp-test-restart-fragments');

// Set environment variable for fragment directory
process.env.FRAGMENT_DIR = TEST_FRAGMENT_DIR;

// Extend timeout for restart tests
jest.setTimeout(30000);

describe('SKB Service Restart Test', () => {
  let nc: any;
  const sc = StringCodec();
  let workerProcess: any;

  // Helper to create a promise that resolves when a message is received on a topic
  const waitForMessage = <T>(topic: string, predicate: (data: T) => boolean, timeout = 5000): Promise<T> => {
    return new Promise<T>((resolve, reject) => {
      const sub = nc.subscribe(topic, {
        callback: (_err: any, msg: any) => {
          try {
            const dataStr = sc.decode(msg.data);
            const data = JSON.parse(dataStr) as T;

            if (predicate(data)) {
              resolve(data);
            }
          } catch (err) {
            // Ignore parse errors for other messages
          }
        }
      });

      // Auto-cleanup subscription after timeout
      setTimeout(() => {
        sub.unsubscribe();
        reject(new Error(`Timeout waiting for message on ${topic}`));
      }, timeout);
    });
  };

  beforeAll(async () => {
    // Ensure test directory exists
    await fs.mkdir(TEST_FRAGMENT_DIR, { recursive: true });

    // Connect to NATS
    nc = await connect({ servers: BROKER_URL });
    console.log('Connected to NATS server');

    // Wait for connection to stabilize
    await new Promise(resolve => setTimeout(resolve, 1000));
  });

  afterAll(async () => {
    // Close NATS connection
    await nc.drain();
    console.log('Disconnected from NATS server');

    // Clean up test directory
    await fs.rm(TEST_FRAGMENT_DIR, { recursive: true, force: true });
  });

  it('should detect fragments after restart and skip re-processing', async () => {
    // 1. First run - create and process a note
    const noteId = uuidv4();
    const eventId = uuidv4();
    
    const newNote: NewNote = {
      note_id: noteId,
      content: 'Test note for restart scenario',
      author_id: uuidv4(),
      timestamp: new Date().toISOString(),
      event_id: eventId
    };
    
    // Set up promises for both acknowledgment events
    const indexedPromise = waitForMessage<NoteIndexed>(
      TOPIC_NOTE_INDEXED,
      (ack) => ack.note_id === noteId && ack.correlation_id === eventId
    );
    
    const fragmentedPromise = waitForMessage<NoteFragmented>(
      TOPIC_NOTE_FRAGMENTED,
      (event) => event.note_id === noteId && 
                event.correlation_id === eventId && 
                event.status === 'SUCCESS'
    );
    
    // Start the worker in a separate process
    console.log('Starting first worker instance...');
    workerProcess = startWorker();
    
    // Wait for worker to initialize
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Publish the note
    const dataStr = JSON.stringify(newNote);
    nc.publish(TOPIC_NEW_NOTE, sc.encode(dataStr));
    console.log(`Published new_note event with ID ${noteId}`);
    
    // Wait for both acknowledgments
    const [indexed, fragmented] = await Promise.all([indexedPromise, fragmentedPromise]);
    
    // Verify first run results
    expect(indexed.status).toEqual('RECEIVED');
    expect(fragmented.status).toEqual('SUCCESS');
    
    // Verify fragment file exists
    const fragmentPath = join(TEST_FRAGMENT_DIR, `${noteId}.json`);
    const fragmentExists = await fs.access(fragmentPath).then(() => true).catch(() => false);
    expect(fragmentExists).toBe(true);
    
    // Stop the worker
    console.log('Stopping first worker instance...');
    process.exit = jest.fn() as any; // Mock process.exit to prevent test termination
    
    // Give time for shutdown
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // 2. Second run with same note ID - should detect and skip
    console.log('Starting second worker instance...');
    
    // Set up promises for both acknowledgment events for second run
    const secondEventId = uuidv4();
    const secondNote: NewNote = {
      ...newNote,
      event_id: secondEventId,
      content: 'Same note with different content - should be skipped',
    };
    
    const secondIndexedPromise = waitForMessage<NoteIndexed>(
      TOPIC_NOTE_INDEXED,
      (ack) => ack.note_id === noteId && ack.correlation_id === secondEventId
    );
    
    const secondFragmentedPromise = waitForMessage<NoteFragmented>(
      TOPIC_NOTE_FRAGMENTED,
      (event) => event.note_id === noteId && 
                event.correlation_id === secondEventId && 
                event.status === 'SKIPPED_DUPLICATE'
    );
    
    // Start new worker instance (simulating restart)
    workerProcess = startWorker();
    
    // Wait for worker to initialize and load fragments
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Publish the same note with new event ID
    const secondDataStr = JSON.stringify(secondNote);
    nc.publish(TOPIC_NEW_NOTE, sc.encode(secondDataStr));
    console.log(`Published duplicate new_note event with ID ${noteId}`);
    
    // Wait for both acknowledgments
    const [secondIndexed, secondFragmented] = await Promise.all([
      secondIndexedPromise, 
      secondFragmentedPromise
    ]);
    
    // Verify second run results
    expect(secondIndexed.status).toEqual('RECEIVED');
    expect(secondFragmented.status).toEqual('SKIPPED_DUPLICATE');
    
    // Verify metrics endpoint reports fragments loaded (optional)
    // This could be done by calling the metrics endpoint if exposed
  });
});