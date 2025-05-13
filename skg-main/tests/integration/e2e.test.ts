/**
 * Integration test for SKB service
 * 
 * Tests the end-to-end flow from publishing a new_note event
 * to receiving a note_indexed acknowledgment.
 */
import { connect, StringCodec } from 'nats';
import { v4 as uuidv4 } from 'uuid';
import { NewNote } from '../../src/types/new_note.v1';
import { NoteIndexed } from '../../src/types/note_indexed.v1';
import { NoteFragmented } from '../../src/types/note_fragmented.v1';

// Broker connection info
const BROKER_URL = process.env.BROKER_URL || 'nats://localhost:4222';
const TOPIC_NEW_NOTE = process.env.TOPIC_IN_NEW_NOTE || 'events.tangent.notes.new.v1';
const TOPIC_NOTE_INDEXED = process.env.TOPIC_OUT_NOTE_INDEXED || 'events.skb.indexing.status.v1';
const TOPIC_NOTE_FRAGMENTED = process.env.TOPIC_OUT_NOTE_FRAGMENTED || 'events.skb.note.fragmented.v1';

// Test timeout - allowing for service startup and processing
jest.setTimeout(10000);

describe('SKB Service Integration Test', () => {
  let nc: any;
  const sc = StringCodec();

  // Keep track of published note IDs to test duplicate detection
  const publishedNoteIds = new Set<string>();

  beforeAll(async () => {
    // Connect to NATS
    nc = await connect({ servers: BROKER_URL });
    console.log('Connected to NATS server');

    // Allow service to start
    await new Promise(resolve => setTimeout(resolve, 1000));
  });

  afterAll(async () => {
    // Close NATS connection
    await nc.drain();
    console.log('Disconnected from NATS server');
  });

  // Helper to create a promise that resolves when a message is received on a topic
  const waitForMessage = <T>(topic: string, predicate: (data: T) => boolean): Promise<T> => {
    return new Promise<T>((resolve) => {
      const sub = nc.subscribe(topic, {
        callback: (_err: any, msg: any) => {
          const dataStr = sc.decode(msg.data);
          const data = JSON.parse(dataStr) as T;

          if (predicate(data)) {
            resolve(data);
          }
        }
      });

      // Auto-cleanup subscription after test
      setTimeout(() => sub.unsubscribe(), 5000);
    });
  };

  it('should handle a valid new_note event and reply with RECEIVED status', async () => {
    // Arrange
    const noteId = uuidv4();
    const eventId = uuidv4();
    
    const newNote: NewNote = {
      note_id: noteId,
      content: 'This is a test note for integration testing',
      author_id: uuidv4(),
      timestamp: new Date().toISOString(),
      event_id: eventId
    };
    
    // Create a promise that will be resolved when we receive the acknowledgment
    const ackPromise = new Promise<NoteIndexed>((resolve) => {
      // Subscribe to note_indexed topic
      const sub = nc.subscribe(TOPIC_NOTE_INDEXED, {
        callback: (_err: any, msg: any) => {
          const dataStr = sc.decode(msg.data);
          const ack = JSON.parse(dataStr) as NoteIndexed;
          
          // We're only interested in acknowledgments for our note
          if (ack.note_id === noteId) {
            resolve(ack);
          }
        }
      });
      
      // Auto-cleanup subscription after test
      setTimeout(() => sub.unsubscribe(), 5000);
    });
    
    // Act
    // Publish the new_note event
    const dataStr = JSON.stringify(newNote);
    nc.publish(TOPIC_NEW_NOTE, sc.encode(dataStr));
    console.log(`Published new_note event with ID ${noteId}`);
    
    // Wait for acknowledgment (with timeout)
    const ack = await ackPromise;
    
    // Assert
    expect(ack.note_id).toEqual(noteId);
    expect(ack.correlation_id).toEqual(eventId);
    expect(ack.status).toEqual('RECEIVED');
    expect(ack.event_id).toBeDefined();
    expect(ack.version).toBeDefined();
    expect(ack.timestamp).toBeDefined();
  });

  it('should handle a malformed new_note event and reply with VALIDATION_FAILED status', async () => {
    // Arrange
    const noteId = uuidv4();
    const eventId = uuidv4();
    
    // Missing required 'content' field
    const invalidNewNote = {
      note_id: noteId,
      // content: missing,
      author_id: uuidv4(),
      timestamp: new Date().toISOString(),
      event_id: eventId
    };
    
    // Create a promise that will be resolved when we receive the acknowledgment
    const ackPromise = new Promise<NoteIndexed>((resolve) => {
      // Subscribe to note_indexed topic
      const sub = nc.subscribe(TOPIC_NOTE_INDEXED, {
        callback: (_err: any, msg: any) => {
          const dataStr = sc.decode(msg.data);
          const ack = JSON.parse(dataStr) as NoteIndexed;
          
          // We're only interested in acknowledgments for our note
          if (ack.note_id === noteId) {
            resolve(ack);
          }
        }
      });
      
      // Auto-cleanup subscription after test
      setTimeout(() => sub.unsubscribe(), 5000);
    });
    
    // Act
    // Publish the invalid new_note event
    const dataStr = JSON.stringify(invalidNewNote);
    nc.publish(TOPIC_NEW_NOTE, sc.encode(dataStr));
    console.log(`Published invalid new_note event with ID ${noteId}`);
    
    // Wait for acknowledgment (with timeout)
    const ack = await ackPromise;
    
    // Assert
    expect(ack.note_id).toEqual(noteId);
    expect(ack.correlation_id).toEqual(eventId);
    expect(ack.status).toEqual('VALIDATION_FAILED');
    expect(ack.error_msg).toBeDefined();
    expect(ack.event_id).toBeDefined();
    expect(ack.version).toBeDefined();
    expect(ack.timestamp).toBeDefined();
  });

  it('should handle completely malformed JSON and reply with INTERNAL_ERROR_M1 status', async () => {
    // Arrange
    const invalidJson = '{ this is not valid JSON';

    // Create a promise that will be resolved when we receive an error acknowledgment
    const ackPromise = new Promise<NoteIndexed>((resolve, reject) => {
      // Subscribe to note_indexed topic
      const sub = nc.subscribe(TOPIC_NOTE_INDEXED, {
        callback: (_err: any, msg: any) => {
          try {
            const dataStr = sc.decode(msg.data);
            const ack = JSON.parse(dataStr) as NoteIndexed;

            // For invalid JSON, we can't match by note_id, so look for INTERNAL_ERROR_M1 status
            if (ack.status === 'INTERNAL_ERROR_M1') {
              resolve(ack);
            }
          } catch (error) {
            reject(error);
          }
        }
      });

      // Timeout handler
      setTimeout(() => {
        sub.unsubscribe();
        reject(new Error('Timeout waiting for error acknowledgment'));
      }, 5000);
    });

    // Act
    // Publish the invalid JSON
    nc.publish(TOPIC_NEW_NOTE, sc.encode(invalidJson));
    console.log('Published invalid JSON');

    // Wait for acknowledgment (with timeout)
    const ack = await ackPromise;

    // Assert
    expect(ack.status).toEqual('INTERNAL_ERROR_M1');
    expect(ack.error_msg).toBeDefined();
    expect(ack.event_id).toBeDefined();
    expect(ack.version).toBeDefined();
    expect(ack.timestamp).toBeDefined();
  });

  it('should generate a knowledge fragment and publish a note_fragmented event', async () => {
    // Arrange - create a test note
    const noteId = uuidv4();
    const eventId = uuidv4();

    const newNote: NewNote = {
      note_id: noteId,
      content: 'Test note content for fragment generation',
      author_id: uuidv4(),
      timestamp: new Date().toISOString(),
      event_id: eventId
    };

    // Store note ID to test for duplicates later
    publishedNoteIds.add(noteId);

    // Set up promises for both acknowledgment events
    const indexedPromise = waitForMessage<NoteIndexed>(
      TOPIC_NOTE_INDEXED,
      (ack) => ack.note_id === noteId
    );

    const fragmentedPromise = waitForMessage<NoteFragmented>(
      TOPIC_NOTE_FRAGMENTED,
      (event) => event.note_id === noteId && event.status === 'SUCCESS'
    );

    // Act - publish the note
    const dataStr = JSON.stringify(newNote);
    nc.publish(TOPIC_NEW_NOTE, sc.encode(dataStr));
    console.log(`Published new_note event with ID ${noteId} for fragment generation`);

    // Wait for both acknowledgments
    const [indexed, fragmented] = await Promise.all([indexedPromise, fragmentedPromise]);

    // Assert - indexed event
    expect(indexed.note_id).toEqual(noteId);
    expect(indexed.correlation_id).toEqual(eventId);
    expect(indexed.status).toEqual('RECEIVED');

    // Assert - fragmented event
    expect(fragmented.note_id).toEqual(noteId);
    expect(fragmented.correlation_id).toEqual(eventId);
    expect(fragmented.status).toEqual('SUCCESS');
    expect(fragmented.entities).toBeGreaterThanOrEqual(0);
    expect(fragmented.relations).toBeGreaterThanOrEqual(0);
  });

  it('should detect duplicate fragments and skip processing', async () => {
    // Get the ID of a previously published note
    const noteId = Array.from(publishedNoteIds)[0];
    const eventId = uuidv4();

    // Create the same note with a new event ID
    const duplicateNote: NewNote = {
      note_id: noteId,
      content: 'This is the same note published again',
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
                event.status === 'SKIPPED_DUPLICATE'
    );

    // Act - publish the duplicate note
    const dataStr = JSON.stringify(duplicateNote);
    nc.publish(TOPIC_NEW_NOTE, sc.encode(dataStr));
    console.log(`Published duplicate new_note event with ID ${noteId}`);

    // Wait for both acknowledgments
    const [indexed, fragmented] = await Promise.all([indexedPromise, fragmentedPromise]);

    // Assert - indexed event
    expect(indexed.note_id).toEqual(noteId);
    expect(indexed.correlation_id).toEqual(eventId);
    expect(indexed.status).toEqual('RECEIVED');

    // Assert - fragmented event
    expect(fragmented.note_id).toEqual(noteId);
    expect(fragmented.correlation_id).toEqual(eventId);
    expect(fragmented.status).toEqual('SKIPPED_DUPLICATE');
    expect(fragmented.entities).toBe(0);
    expect(fragmented.relations).toBe(0);
  });
});