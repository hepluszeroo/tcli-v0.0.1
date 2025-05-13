/* Generated from JSON schema - do not edit manually */

/**
 * Acknowledgement that a note has been processed by the SKB service
 */
export interface NoteIndexed {
  /**
   * Unique identifier for the note that was processed
   */
  note_id: string;
  /**
   * Unique identifier for this event
   */
  event_id: string;
  /**
   * ID of the original new_note event this is acknowledging
   */
  correlation_id: string;
  /**
   * Status of the note indexing operation
   */
  status: "RECEIVED" | "VALIDATION_FAILED" | "INTERNAL_ERROR_M1";
  /**
   * Version of the SKB service that processed the note
   */
  version?: string;
  /**
   * Optional error message if processing failed
   */
  error_msg?: string;
  /**
   * ISO 8601 timestamp of when the note was indexed
   */
  timestamp?: string;
}
