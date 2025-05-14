/* Type definitions for graph_updated event */

export interface GraphUpdated {
  /**
   * Unique ID for this event
   */
  event_id: string;
  
  /**
   * ID of the event that triggered this update (correlation_id)
   */
  correlation_id: string;
  
  /**
   * ID of the note that was merged into the graph
   */
  note_id: string;
  
  /**
   * Timestamp when the event was created (ISO format)
   */
  timestamp: string;
  
  /**
   * Number of entities in the global graph after the update
   */
  total_entities: number;
  
  /**
   * Number of triples/edges in the global graph after the update
   */
  total_triples: number;
  
  /**
   * Number of entities added in this update
   */
  added_entities: number;
  
  /**
   * Number of entities merged/deduplicated in this update
   */
  merged_entities: number;
  
  /**
   * Number of triples added in this update
   */
  added_triples: number;
  
  /**
   * Number of conflicts encountered during the merge
   */
  conflicts: number;
}