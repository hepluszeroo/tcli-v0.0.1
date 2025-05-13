/**
 * Chaos tests for SKB service
 * 
 * Tests the resilience of the service under chaotic conditions:
 * 1. Duplicate events (same event_id)
 * 2. Broker outage (NATS container stop/start)
 * 3. Oversized payloads (>256 KiB)
 */
import { connect, StringCodec, NatsConnection } from 'nats';
import { v4 as uuidv4 } from 'uuid';
import { NewNote } from '../../src/types/new_note.v1';
import { NoteIndexed } from '../../src/types/note_indexed.v1';
import { exec } from 'child_process';
import { promisify } from 'util';

// Promisify exec
const execAsync = promisify(exec);

// Broker connection info
const BROKER_URL = process.env.BROKER_URL || 'nats://localhost:4222';
const TOPIC_NEW_NOTE = process.env.TOPIC_IN_NEW_NOTE || 'events.tangent.notes.new.v1';
const TOPIC_NOTE_INDEXED = process.env.TOPIC_OUT_NOTE_INDEXED || 'events.skb.indexing.status.v1';

// Maximum content size (256 KiB)
const MAX_CONTENT_SIZE_BYTES = 262144;

// Longer timeout for chaos tests
jest.setTimeout(30000);

describe('SKB Service Chaos Tests', () => {
  let nc: NatsConnection;
  const sc = StringCodec();

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

  /**
   * Helper to publish a new_note event and wait for an acknowledgment
   */
  async function publishAndWaitForAck(newNote: NewNote): Promise<NoteIndexed> {
    // Create a promise that will be resolved when we receive the acknowledgment
    const ackPromise = new Promise<NoteIndexed>((resolve, reject) => {
      // Subscribe to note_indexed topic
      const sub = nc.subscribe(TOPIC_NOTE_INDEXED, {
        callback: (_err: any, msg: any) => {
          const dataStr = sc.decode(msg.data);
          const ack = JSON.parse(dataStr) as NoteIndexed;
          
          // We're only interested in acknowledgments for our note
          if (ack.note_id === newNote.note_id) {
            resolve(ack);
          }
        }
      });
      
      // Auto-cleanup subscription after test
      setTimeout(() => {
        sub.unsubscribe();
        reject(new Error('Timeout waiting for acknowledgment'));
      }, 10000);
    });
    
    // Publish the new_note event
    const dataStr = JSON.stringify(newNote);
    nc.publish(TOPIC_NEW_NOTE, sc.encode(dataStr));
    console.log(`Published new_note event with ID ${newNote.note_id}`);
    
    // Wait for acknowledgment
    return ackPromise;
  }

  it('should handle duplicate events (same event_id) without crashing', async () => {
    // Arrange
    const noteId = uuidv4();
    const eventId = uuidv4();
    
    const newNote: NewNote = {
      note_id: noteId,
      content: 'This is a test note for duplicate event testing',
      author_id: uuidv4(),
      timestamp: new Date().toISOString(),
      event_id: eventId
    };
    
    // Act & Assert - First submission
    const firstAck = await publishAndWaitForAck(newNote);
    expect(firstAck.note_id).toEqual(noteId);
    expect(firstAck.correlation_id).toEqual(eventId);
    expect(firstAck.status).toEqual('RECEIVED');
    
    // Act & Assert - Second submission (duplicate)
    const secondAck = await publishAndWaitForAck(newNote);
    expect(secondAck.note_id).toEqual(noteId);
    expect(secondAck.correlation_id).toEqual(eventId);
    expect(secondAck.status).toEqual('RECEIVED');
    
    // In Phase 4, with duplicate detection implemented, the test would
    // check for a 'DUPLICATE' status instead of 'RECEIVED'
  });

  it('should handle broker outage and recover', async () => {
    // Arrange - ensure we're connected
    expect(nc.status().type).not.toEqual('disconnected');
    
    // Create a note to send after recovery
    const noteId = uuidv4();
    const eventId = uuidv4();
    const newNote: NewNote = {
      note_id: noteId,
      content: 'This is a test note for broker outage testing',
      author_id: uuidv4(),
      timestamp: new Date().toISOString(),
      event_id: eventId
    };
    
    // Act - Stop the NATS container
    console.log('Stopping NATS container...');
    await execAsync('docker-compose stop nats');
    
    // Wait a moment to ensure NATS is stopped
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Start NATS again
    console.log('Starting NATS container...');
    await execAsync('docker-compose start nats');
    
    // Wait for NATS to start and SKB to reconnect
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // Reconnect our test client
    nc = await connect({ servers: BROKER_URL });
    console.log('Test client reconnected to NATS');
    
    // Assert - Send a message and check if we get a response
    const ack = await publishAndWaitForAck(newNote);
    expect(ack.note_id).toEqual(noteId);
    expect(ack.correlation_id).toEqual(eventId);
    expect(ack.status).toEqual('RECEIVED');
  });

  it('should handle oversized payload (>256 KiB) and return validation error', async () => {
    // Arrange
    const noteId = uuidv4();
    const eventId = uuidv4();
    
    // Create a large string (>256 KiB) - around 300 KB
    const largeContent = 'X'.repeat(300 * 1024);
    
    const newNote: NewNote = {
      note_id: noteId,
      content: largeContent,
      author_id: uuidv4(),
      timestamp: new Date().toISOString(),
      event_id: eventId
    };
    
    // Act
    const ack = await publishAndWaitForAck(newNote);
    
    // Assert
    expect(ack.note_id).toEqual(noteId);
    expect(ack.correlation_id).toEqual(eventId);
    expect(ack.status).toEqual('VALIDATION_FAILED');
    expect(ack.error_msg).toBeDefined();
    expect(ack.error_msg).toContain('exceeds maximum allowed size');
  });
});