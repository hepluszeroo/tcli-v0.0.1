import Ajv, { ValidateFunction, ErrorObject } from 'ajv';
import addFormats from 'ajv-formats';
import newNoteSchema from '../schemas/new_note.v1.schema.json';
import noteIndexedSchema from '../schemas/note_indexed.v1.schema.json';
import eventEnvelopeSchema from '../schemas/event_envelope.schema.json';
import fragmentSchema from '../schemas/knowledge_fragment.v1.schema.json';
import noteFragmentedSchema from '../schemas/note_fragmented.v1.schema.json';
import { logger } from './logger';
import { NewNote } from '../types/new_note.v1';
import { NoteIndexed } from '../types/note_indexed.v1';
import { EventEnvelope } from '../types/event_envelope';
import { KnowledgeFragment } from '../types/knowledge_fragment.v1';
import { NoteFragmented } from '../types/note_fragmented.v1';

// Type for validation errors
export interface ValidationError {
  path: string;
  message: string;
}

export class SchemaValidationError extends Error {
  public readonly errors: ValidationError[];

  constructor(message: string, errors: ValidationError[]) {
    super(message);
    this.name = 'SchemaValidationError';
    this.errors = errors;
  }
}

// Create and configure Ajv instance
const ajv = new Ajv({
  allErrors: true,
  removeAdditional: 'all',
  useDefaults: true,
});

// Add formats like 'date-time', 'uuid', etc.
addFormats(ajv);

// Compile validators once at startup
const validateNewNote: ValidateFunction = ajv.compile(newNoteSchema);
const validateNoteIndexed: ValidateFunction = ajv.compile(noteIndexedSchema);
const validateEventEnvelope: ValidateFunction = ajv.compile(eventEnvelopeSchema);
const validateFragment: ValidateFunction = ajv.compile(fragmentSchema);
const validateNoteFragmented: ValidateFunction = ajv.compile(noteFragmentedSchema);

/**
 * Validate a new_note message against its schema
 * @param data The data to validate
 * @returns The validated data (with defaults applied)
 * @throws Error with validation details if validation fails
 */
export function validateNewNoteMessage(data: unknown): NewNote {
  const valid = validateNewNote(data);

  if (!valid) {
    const errors = formatValidationErrors(validateNewNote.errors || []);
    const error = new SchemaValidationError(`Invalid new_note message`, errors);

    logger.warn({
      schema: 'new_note.v1',
      errors,
      data
    }, 'Schema validation failed');

    throw error;
  }

  return data as NewNote;
}

/**
 * Validate a note_indexed message against its schema
 * @param data The data to validate
 * @returns The validated data (with defaults applied)
 * @throws Error with validation details if validation fails
 */
export function validateNoteIndexedMessage(data: unknown): NoteIndexed {
  const valid = validateNoteIndexed(data);

  if (!valid) {
    const errors = formatValidationErrors(validateNoteIndexed.errors || []);
    const error = new SchemaValidationError(`Invalid note_indexed message`, errors);

    logger.warn({
      schema: 'note_indexed.v1',
      errors,
      data
    }, 'Schema validation failed');

    throw error;
  }

  return data as NoteIndexed;
}

/**
 * Validate an event envelope against its schema
 * @param data The data to validate
 * @returns The validated data (with defaults applied)
 * @throws Error with validation details if validation fails
 */
export function validateEventEnvelopeMessage(data: unknown): EventEnvelope {
  const valid = validateEventEnvelope(data);

  if (!valid) {
    const errors = formatValidationErrors(validateEventEnvelope.errors || []);
    const error = new SchemaValidationError(`Invalid event envelope`, errors);

    logger.warn({
      schema: 'event_envelope',
      errors,
      data
    }, 'Schema validation failed');

    throw error;
  }

  return data as EventEnvelope;
}

/**
 * Format AJV errors into a more readable structure
 */
function formatValidationErrors(errors: ErrorObject[]): ValidationError[] {
  return errors.map(error => ({
    path: error.instancePath || '/',
    message: error.message || 'Unknown validation error',
  }));
}

/**
 * Create a payload that's too large error
 * @param contentSize The size of the content in bytes
 * @param maxSize The maximum allowed size in bytes
 */
export function createPayloadTooLargeError(contentSize: number, maxSize: number): SchemaValidationError {
  const error: ValidationError = {
    path: '/content',
    message: `Content size ${contentSize} bytes exceeds maximum allowed size of ${maxSize} bytes`,
  };

  return new SchemaValidationError('PayloadTooLargeError', [error]);
}

/**
 * Validate a knowledge fragment against its schema
 * @param data The data to validate
 * @returns The validated data (with defaults applied)
 * @throws Error with validation details if validation fails
 */
export function validateFragmentMessage(data: unknown): KnowledgeFragment {
  const valid = validateFragment(data);

  if (!valid) {
    const errors = formatValidationErrors(validateFragment.errors || []);
    const error = new SchemaValidationError(`Invalid knowledge fragment`, errors);

    logger.warn({
      schema: 'knowledge_fragment.v1',
      errors,
      data
    }, 'Schema validation failed');

    throw error;
  }

  return data as KnowledgeFragment;
}

/**
 * Validate a note_fragmented message against its schema
 * @param data The data to validate
 * @returns The validated data (with defaults applied)
 * @throws Error with validation details if validation fails
 */
export function validateNoteFragmentedMessage(data: unknown): NoteFragmented {
  const valid = validateNoteFragmented(data);

  if (!valid) {
    const errors = formatValidationErrors(validateNoteFragmented.errors || []);
    const error = new SchemaValidationError(`Invalid note_fragmented message`, errors);

    logger.warn({
      schema: 'note_fragmented.v1',
      errors,
      data
    }, 'Schema validation failed');

    throw error;
  }

  return data as NoteFragmented;
}