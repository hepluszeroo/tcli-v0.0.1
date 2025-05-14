/**
 * Unit tests for note_fragmented validation
 */
import { validateNoteFragmentedMessage, SchemaValidationError } from '../../src/utils/schema-validator';
import { NoteFragmented } from '../../src/types/note_fragmented.v1';

describe('NoteFragmented Validation', () => {
  it('should validate a properly formatted note_fragmented message', () => {
    const validMessage: NoteFragmented = {
      note_id: '123e4567-e89b-12d3-a456-426614174000',
      event_id: '123e4567-e89b-12d3-a456-426614174001',
      correlation_id: '123e4567-e89b-12d3-a456-426614174002',
      status: 'SUCCESS',
      entities: 5,
      relations: 3,
      timestamp: new Date().toISOString()
    };

    expect(() => validateNoteFragmentedMessage(validMessage)).not.toThrow();
    
    const validated = validateNoteFragmentedMessage(validMessage);
    expect(validated).toHaveProperty('note_id');
    expect(validated).toHaveProperty('event_id');
    expect(validated).toHaveProperty('correlation_id');
    expect(validated).toHaveProperty('status');
    expect(validated).toHaveProperty('entities');
    expect(validated).toHaveProperty('relations');
    expect(validated).toHaveProperty('timestamp');
  });

  it('should validate a skipped duplicate message', () => {
    const skippedMessage: NoteFragmented = {
      note_id: '123e4567-e89b-12d3-a456-426614174000',
      event_id: '123e4567-e89b-12d3-a456-426614174001',
      correlation_id: '123e4567-e89b-12d3-a456-426614174002',
      status: 'SKIPPED_DUPLICATE',
      timestamp: new Date().toISOString()
    };

    expect(() => validateNoteFragmentedMessage(skippedMessage)).not.toThrow();
  });

  it('should validate an error message', () => {
    const errorMessage: NoteFragmented = {
      note_id: '123e4567-e89b-12d3-a456-426614174000',
      event_id: '123e4567-e89b-12d3-a456-426614174001',
      correlation_id: '123e4567-e89b-12d3-a456-426614174002',
      status: 'ERROR_KGGEN',
      timestamp: new Date().toISOString()
    };

    expect(() => validateNoteFragmentedMessage(errorMessage)).not.toThrow();
  });

  it('should reject a message with invalid status', () => {
    const invalidMessage = {
      note_id: '123e4567-e89b-12d3-a456-426614174000',
      event_id: '123e4567-e89b-12d3-a456-426614174001',
      correlation_id: '123e4567-e89b-12d3-a456-426614174002',
      status: 'INVALID_STATUS', // Invalid status
      timestamp: new Date().toISOString()
    };

    expect(() => validateNoteFragmentedMessage(invalidMessage)).toThrow(SchemaValidationError);
  });

  it('should reject a message with missing required fields', () => {
    const missingFields = {
      note_id: '123e4567-e89b-12d3-a456-426614174000',
      // missing event_id
      // missing correlation_id
      // missing status
      timestamp: new Date().toISOString()
    };

    expect(() => validateNoteFragmentedMessage(missingFields)).toThrow(SchemaValidationError);
  });

  it('should reject a message with negative entity count', () => {
    const invalidEntities = {
      note_id: '123e4567-e89b-12d3-a456-426614174000',
      event_id: '123e4567-e89b-12d3-a456-426614174001',
      correlation_id: '123e4567-e89b-12d3-a456-426614174002',
      status: 'SUCCESS',
      entities: -5, // Invalid negative value
      relations: 3,
      timestamp: new Date().toISOString()
    };

    expect(() => validateNoteFragmentedMessage(invalidEntities)).toThrow(SchemaValidationError);
  });
});