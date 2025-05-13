#!/usr/bin/env ts-node
/**
 * Re-index Note Script
 *
 * Utility for re-processing a specific note through the knowledge graph generation
 * pipeline by deleting its fragment file and publishing a synthetic new_note event.
 *
 * Usage: npx ts-node scripts/reindex-note.ts <note_id>
 */
import { promises as fs } from 'fs';
import { join } from 'path';
import { v4 as uuidv4 } from 'uuid';
import { BrokerAdapter } from '../src/broker/adapter';
import { logger } from '../src/utils/logger';
import Config from '../src/config';
import { NewNote } from '../src/types/new_note.v1';

// Fragment directory path
const FRAGMENT_DIR = process.env.FRAGMENT_DIR || './graph_fragments';

async function main(): Promise<void> {
  try {
    // Get note ID from command line argument
    const noteId = process.argv[2];
    if (!noteId) {
      console.error('Error: Note ID is required');
      console.error('Usage: npx ts-node scripts/reindex-note.ts <note_id>');
      process.exit(1);
    }

    // Check if the fragment file exists
    const fragmentPath = join(FRAGMENT_DIR, `${noteId}.json`);
    try {
      await fs.access(fragmentPath);
      console.log(`Found fragment file: ${fragmentPath}`);
    } catch (err) {
      console.warn(`Fragment file not found: ${fragmentPath}`);
      console.warn('Will create a new fragment if note content is available');
    }

    // Ask for note content
    console.log('\nPlease provide note content (or leave empty to just delete the fragment):');
    let content = '';
    
    // Read content from stdin
    process.stdin.on('data', (data) => {
      content += data.toString();
    });
    
    process.stdin.on('end', async () => {
      // First, try to delete the existing fragment file
      try {
        await fs.unlink(fragmentPath);
        console.log(`Deleted fragment file: ${fragmentPath}`);
      } catch (err) {
        // Ignore errors if file doesn't exist
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
          console.warn(`Warning: Failed to delete fragment file: ${err}`);
        }
      }
      
      // If no content provided, just exit after deletion
      if (!content.trim()) {
        console.log('\nNo content provided. Fragment file deleted but no re-indexing triggered.');
        process.exit(0);
      }
      
      // Connect to broker
      console.log('\nConnecting to message broker...');
      const broker = await BrokerAdapter.connect(Config.broker.url);
      
      // Prepare synthetic new_note event
      const note: NewNote = {
        note_id: noteId,
        event_id: uuidv4(),
        content: content.trim(),
        author_id: uuidv4(), // Use a valid UUID format for author_id
        timestamp: new Date().toISOString(),
        metadata: {
          title: `Reindexed note ${noteId}`,
          tags: ['reindexed'],
        }
      };
      
      // Publish event
      console.log(`Publishing synthetic new_note event for note_id: ${noteId}`);
      await broker.publish(Config.topics.in.newNote, note);
      console.log('Event published successfully!');
      
      // Close connection
      await broker.close();
      console.log('Done. Note should be re-processed by the SKB service.');
      process.exit(0);
    });
    
    // Ensure stdin is in the correct mode
    process.stdin.resume();
    
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

// Execute if run directly
if (require.main === module) {
  main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}