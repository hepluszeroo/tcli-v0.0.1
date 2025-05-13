/**
 * Tests for the schema validator
 */
import { 
  validateNewNoteMessage, 
  validateNoteIndexedMessage, 
  SchemaValidationError,
  createPayloadTooLargeError
} from '../../src/utils/schema-validator';

describe('Schema Validator', () => {
  describe('validateNewNoteMessage', () => {
    it('should validate a valid NewNote message', () => {
      // Arrange
      const validNewNote = {
        note_id: '123e4567-e89b-12d3-a456-426614174000',
        content: 'This is a test note',
        author_id: '123e4567-e89b-12d3-a456-426614174001',
        timestamp: '2023-01-01T12:00:00Z',
        event_id: '123e4567-e89b-12d3-a456-426614174003'
      };

      // Act & Assert
      expect(() => validateNewNoteMessage(validNewNote)).not.toThrow();
      expect(validateNewNoteMessage(validNewNote)).toEqual(validNewNote);
    });

    it('should fail when required fields are missing', () => {
      // Arrange
      const invalidNewNote = {
        // Missing note_id
        content: 'This is a test note',
        author_id: '123e4567-e89b-12d3-a456-426614174001',
        timestamp: '2023-01-01T12:00:00Z'
      };

      // Act & Assert
      expect(() => validateNewNoteMessage(invalidNewNote)).toThrow(SchemaValidationError);
      expect(() => validateNewNoteMessage(invalidNewNote)).toThrow(/Invalid new_note message/);
    });

    it('should fail with invalid UUID format', () => {
      // Arrange
      const invalidNewNote = {
        note_id: 'not-a-uuid',  // Invalid UUID format
        content: 'This is a test note',
        author_id: '123e4567-e89b-12d3-a456-426614174001',
        timestamp: '2023-01-01T12:00:00Z'
      };

      // Act & Assert
      expect(() => validateNewNoteMessage(invalidNewNote)).toThrow(SchemaValidationError);
    });

    it('should fail with invalid timestamp format', () => {
      // Arrange
      const invalidNewNote = {
        note_id: '123e4567-e89b-12d3-a456-426614174000',
        content: 'This is a test note',
        author_id: '123e4567-e89b-12d3-a456-426614174001',
        timestamp: '2023-01-01'  // Invalid date-time format
      };

      // Act & Assert
      expect(() => validateNewNoteMessage(invalidNewNote)).toThrow(SchemaValidationError);
    });

    it('should allow optional metadata', () => {
      // Arrange
      const validNewNote = {
        note_id: '123e4567-e89b-12d3-a456-426614174000',
        content: 'This is a test note',
        author_id: '123e4567-e89b-12d3-a456-426614174001',
        timestamp: '2023-01-01T12:00:00Z',
        metadata: {
          title: 'Test Note',
          tags: ['test', 'example'],
          workspace_id: '123e4567-e89b-12d3-a456-426614174002',
          path: '/test/path'
        }
      };

      // Act & Assert
      expect(() => validateNewNoteMessage(validNewNote)).not.toThrow();
      expect(validateNewNoteMessage(validNewNote)).toEqual(validNewNote);
    });

    it('should validate with minimum required fields', () => {
      // Arrange
      const minimalNewNote = {
        note_id: '123e4567-e89b-12d3-a456-426614174000',
        content: 'This is a test note',
        author_id: '123e4567-e89b-12d3-a456-426614174001',
        timestamp: '2023-01-01T12:00:00Z'
      };

      // Act & Assert
      expect(() => validateNewNoteMessage(minimalNewNote)).not.toThrow();
      expect(validateNewNoteMessage(minimalNewNote)).toEqual(minimalNewNote);
    });
  });

  describe('validateNoteIndexedMessage', () => {
    it('should validate a valid NoteIndexed message', () => {
      // Arrange
      const validNoteIndexed = {
        note_id: '123e4567-e89b-12d3-a456-426614174000',
        event_id: '123e4567-e89b-12d3-a456-426614174003',
        correlation_id: '123e4567-e89b-12d3-a456-426614174002',
        status: 'RECEIVED',
        version: '0.1.0',
        timestamp: '2023-01-01T12:00:00Z'
      };

      // Act & Assert
      expect(() => validateNoteIndexedMessage(validNoteIndexed)).not.toThrow();
      expect(validateNoteIndexedMessage(validNoteIndexed)).toEqual(validNoteIndexed);
    });

    it('should validate error status with error message', () => {
      // Arrange
      const errorNoteIndexed = {
        note_id: '123e4567-e89b-12d3-a456-426614174000',
        event_id: '123e4567-e89b-12d3-a456-426614174003',
        correlation_id: '123e4567-e89b-12d3-a456-426614174002',
        status: 'VALIDATION_FAILED',
        error_msg: 'Missing required field: content',
        version: '0.1.0',
        timestamp: '2023-01-01T12:00:00Z'
      };

      // Act & Assert
      expect(() => validateNoteIndexedMessage(errorNoteIndexed)).not.toThrow();
      expect(validateNoteIndexedMessage(errorNoteIndexed)).toEqual(errorNoteIndexed);
    });

    it('should fail when required fields are missing', () => {
      // Arrange
      const invalidNoteIndexed = {
        note_id: '123e4567-e89b-12d3-a456-426614174000',
        // Missing event_id
        correlation_id: '123e4567-e89b-12d3-a456-426614174002',
        status: 'RECEIVED'
      };

      // Act & Assert
      expect(() => validateNoteIndexedMessage(invalidNoteIndexed)).toThrow(SchemaValidationError);
    });

    it('should fail with invalid status value', () => {
      // Arrange
      const invalidNoteIndexed = {
        note_id: '123e4567-e89b-12d3-a456-426614174000',
        event_id: '123e4567-e89b-12d3-a456-426614174003',
        correlation_id: '123e4567-e89b-12d3-a456-426614174002',
        status: 'INVALID_STATUS', // Invalid status
        version: '0.1.0'
      };

      // Act & Assert
      expect(() => validateNoteIndexedMessage(invalidNoteIndexed)).toThrow(SchemaValidationError);
    });
  });

  describe('createPayloadTooLargeError', () => {
    it('should create a proper error for oversized content', () => {
      // Arrange
      const contentSize = 300 * 1024; // 300 KiB
      const maxSize = 256 * 1024;     // 256 KiB

      // Act
      const error = createPayloadTooLargeError(contentSize, maxSize);

      // Assert
      expect(error).toBeInstanceOf(SchemaValidationError);
      expect(error.message).toBe('PayloadTooLargeError');
      expect(error.errors.length).toBe(1);
      expect(error.errors[0].path).toBe('/content');
      expect(error.errors[0].message).toContain('Content size 307200 bytes exceeds maximum allowed size of 262144 bytes');
    });
  });
});