/* Generated from JSON schema - do not edit manually */

/**
 * Event emitted when a new note is created in Tangent
 */
export interface NewNote {
  /**
   * Unique identifier for the note
   */
  note_id: string;
  /**
   * The full text content of the note
   */
  content: string;
  /**
   * Identifier of the note's author
   */
  author_id: string;
  /**
   * ISO 8601 timestamp of when the note was created
   */
  timestamp: string;
  /**
   * Additional contextual information about the note
   */
  metadata?: {
    /**
     * Optional title of the note
     */
    title?: string;
    /**
     * Tags associated with the note
     */
    tags?: string[];
    /**
     * Identifier of the workspace containing the note
     */
    workspace_id?: string;
    /**
     * File path of the note within the workspace
     */
    path?: string;
  };
  /**
   * Unique identifier for this event
   */
  event_id?: string;
}
