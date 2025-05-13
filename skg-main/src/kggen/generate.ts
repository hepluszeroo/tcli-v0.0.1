/**
 * KGGen module - Interface for interacting with the STAIR-Lab KGGen CLI tool
 * 
 * This module provides functionality to generate knowledge graph fragments from text 
 * by invoking the KGGen CLI as a subprocess.
 */
import { v4 as uuidv4 } from 'uuid';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { spawn } from 'child_process';
import { KnowledgeFragment } from '../types/knowledge_fragment.v1';
import { logger } from '../utils/logger';
import { metrics } from '../metrics/metrics';
import { validateFragmentMessage } from '../utils/schema-validator';

// Define paths
const FRAGMENT_DIR = process.env.FRAGMENT_DIR || '/data/skb/graph_fragments';

/**
 * Generate a mock knowledge graph fragment
 * @param noteId The ID of the note
 * @param text The text content of the note (unused in mock)
 * @returns A promise resolving to the generated mock knowledge fragment
 */
export async function mockGenerate(noteId: string, text: string): Promise<KnowledgeFragment> {
  logger.debug({ noteId }, 'Generating mock knowledge fragment for note');

  const outPath = join(FRAGMENT_DIR, `${noteId}.json`);

  // Create a mock fragment
  const mockFragment: KnowledgeFragment = {
    note_id: noteId,
    entities: [
      { id: 'e1', label: 'Mock Entity 1', type: 'Concept' },
      { id: 'e2', label: 'Mock Entity 2', type: 'Concept' }
    ],
    relations: ['related_to'],
    triples: [
      { subject: 'e1', predicate: 'related_to', object: 'e2' }
    ]
  };

  try {
    // Ensure fragment directory exists
    await fs.mkdir(dirname(outPath), { recursive: true });

    // Write the mock fragment to the output file
    await fs.writeFile(outPath, JSON.stringify(mockFragment, null, 2), 'utf8');

    return mockFragment;
  } catch (error) {
    logger.error({ error, noteId }, 'Failed to write mock fragment');
    throw error;
  }
}

/**
 * Generate a knowledge graph fragment from note content
 * @param noteId The ID of the note
 * @param text The text content of the note
 * @returns A promise resolving to the generated knowledge fragment
 */
export async function generateFragment(noteId: string, text: string): Promise<KnowledgeFragment> {
  logger.debug({ noteId }, 'Generating knowledge fragment for note');

  // Use mock generation if specified in environment
  if (process.env.KGGEN_MODE === 'mock') {
    return mockGenerate(noteId, text);
  }

  // Create a unique temporary file for the text input
  const tmpPath = join(tmpdir(), `${noteId}-${uuidv4()}.txt`);
  const outPath = join(FRAGMENT_DIR, `${noteId}.json`);

  try {
    // Ensure fragment directory exists
    await fs.mkdir(dirname(outPath), { recursive: true });

    // Write the text content to a temporary file
    await fs.writeFile(tmpPath, text, 'utf8');

    // Production: Run the actual KGGen CLI
    // NO try/catch or fallback here - errors MUST propagate up
    // so that the worker layer can report ERROR_KGGEN status
    await runKggenCli(tmpPath, outPath);

    // Read and validate the generated fragment
    const raw = await fs.readFile(outPath, 'utf8');
    const fragment = JSON.parse(raw);

    // Ensure the fragment has the correct note_id
    if (!fragment.note_id) {
      fragment.note_id = noteId;
    } else if (fragment.note_id !== noteId) {
      logger.warn({
        expectedId: noteId,
        actualId: fragment.note_id
      }, 'Fragment has incorrect note_id, fixing');
      fragment.note_id = noteId;

      // Re-write the file with the corrected note_id
      await fs.writeFile(outPath, JSON.stringify(fragment, null, 2), 'utf8');
    }

    // Validate the fragment against schema
    validateFragmentMessage(fragment);

    // Record successful fragment generation in metrics
    metrics.fragmentsGenerated.inc();

    logger.info({ noteId }, 'Successfully generated knowledge fragment');

    return fragment as KnowledgeFragment;
  } catch (error) {
    // Record failure in metrics
    metrics.kggenFailures.inc();

    logger.error({
      noteId,
      error
    }, 'Failed to generate knowledge fragment');

    throw error;
  } finally {
    // Clean up temporary file regardless of success/failure
    try {
      await fs.unlink(tmpPath);
    } catch (error) {
      // Ignore errors during cleanup
    }
  }
}

// KGGen CLI configuration
const KGGEN_BIN = process.env.KGGEN_BIN || 'python3';
const KGGEN_SCRIPT = process.env.KGGEN_SCRIPT || join(process.cwd(), 'scripts', 'kg_gen_cli.py');
const KGGEN_EXTRA_ARGS = process.env.KGGEN_EXTRA_ARGS ? process.env.KGGEN_EXTRA_ARGS.split(' ') : [];

// Timeout for KGGen process in milliseconds (default: 2 minutes)
const KGGEN_TIMEOUT = parseInt(process.env.KGGEN_TIMEOUT || '120000', 10);

/**
 * Run the KGGen CLI tool as a subprocess
 * @param input Path to the input text file
 * @param output Path to the output JSON file
 */
export async function runKggenCli(input: string, output: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    // Start execution timer
    const startTime = Date.now();

    // Log the execution configuration
    logger.debug({
      input,
      output,
      cli: KGGEN_BIN,
      script: KGGEN_SCRIPT,
      extraArgs: KGGEN_EXTRA_ARGS,
      model: process.env.KGGEN_MODEL || 'openai/gpt-4',
      timeout: KGGEN_TIMEOUT
    }, 'Running KGGen CLI');

    // Prepare command arguments
    const args = [
      KGGEN_SCRIPT,
      '--input', input,
      '--output', output,
      '--model', process.env.KGGEN_MODEL || 'openai/gpt-4',
      ...KGGEN_EXTRA_ARGS
    ];

    // Capture stderr for logging
    const stderrChunks: Buffer[] = [];

    // Spawn the KGGen process
    const kggenProcess = spawn(KGGEN_BIN, args, {
      stdio: ['ignore', 'inherit', 'pipe'],  // Redirect stderr to capture it
      env: process.env  // Use existing environment - no hard-coded PYTHONPATH
    });

    // Capture stderr
    kggenProcess.stderr?.on('data', (chunk) => {
      stderrChunks.push(Buffer.from(chunk));
    });

    // Set timeout to kill long-running processes
    const timeoutId = setTimeout(() => {
      kggenProcess.kill();
      const duration = Date.now() - startTime;
      logger.error({ input, output, duration }, 'KGGen process timed out after ${KGGEN_TIMEOUT}ms');
      reject(new Error(`KGGen process timed out after ${KGGEN_TIMEOUT}ms`));
    }, KGGEN_TIMEOUT);

    kggenProcess.on('exit', code => {
      // Clear timeout
      clearTimeout(timeoutId);

      // Calculate execution time
      const duration = Date.now() - startTime;

      // Get captured stderr if any
      const stderr = Buffer.concat(stderrChunks).toString().trim();

      if (code === 0) {
        // Log success with execution time
        logger.info({
          input,
          output,
          duration,
          kggen_exec_ms: duration
        }, 'KGGen process completed successfully');

        // Track successful execution time in metrics
        metrics.kggenExecutionTime.observe(duration);

        resolve();
      } else {
        // Log the error with stderr output
        logger.error({
          input,
          output,
          code,
          duration,
          stderr
        }, 'KGGen process exited with error code');

        // Track failure in metrics
        metrics.kggenFailures.inc();

        // Fail fast - no fallback
        reject(new Error(`KGGen process exited with code ${code}${stderr ? ': ' + stderr : ''}`));
      }
    });

    kggenProcess.on('error', error => {
      // Clear timeout
      clearTimeout(timeoutId);

      const duration = Date.now() - startTime;
      logger.error({
        input,
        output,
        error,
        duration,
        stderr: Buffer.concat(stderrChunks).toString().trim()
      }, 'Failed to start KGGen process');

      // Track failure in metrics
      metrics.kggenFailures.inc();

      reject(new Error(`Failed to start KGGen process: ${error.message}`));
    });
  });
}

/**
 * Check if a fragment already exists for a note
 * @param noteId The ID of the note
 * @returns A promise resolving to a boolean indicating if the fragment exists
 */
export async function fragmentExists(noteId: string): Promise<boolean> {
  const path = join(FRAGMENT_DIR, `${noteId}.json`);
  
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Type definition for the generateFragment function
 * This is exported to make it easier to mock in tests
 */
export type KgGenFn = typeof generateFragment;