/* Generated from JSON schema - do not edit manually */

/**
 * Event emitted when a note has been processed by the KG generator
 */
export interface NoteFragmented {
  /**
   * ID of the note that was processed
   */
  note_id: string;
  /**
   * Unique ID for this event
   */
  event_id: string;
  /**
   * ID of the original new_note event that triggered this
   */
  correlation_id: string;
  /**
   * Result of the knowledge graph generation process
   */
  status: "SUCCESS" | "ERROR_KGGEN" | "SKIPPED_DUPLICATE";
  /**
   * Number of entities extracted from the note
   */
  entities?: number;
  /**
   * Number of relation types used in the knowledge graph
   */
  relations?: number;
  /**
   * ISO 8601 timestamp of when the note was processed
   */
  timestamp?: string;
}
