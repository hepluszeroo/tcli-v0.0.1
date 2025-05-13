/* Generated from JSON schema - do not edit manually */

export interface KnowledgeFragment {
  /**
   * UUID of the note this fragment belongs to
   */
  note_id: string;
  /**
   * List of entities extracted from the note
   */
  entities: {
    /**
     * Unique identifier for the entity within this fragment
     */
    id: string;
    /**
     * Human-readable label for the entity
     */
    label: string;
    /**
     * Type classification of the entity (e.g., Person, Organization, Concept)
     */
    type: string;
  }[];
  /**
   * List of relation types used in the knowledge graph
   */
  relations: string[];
  /**
   * List of subject-predicate-object statements forming the knowledge graph
   */
  triples: {
    /**
     * Subject entity ID
     */
    subject: string;
    /**
     * Relation type connecting subject to object
     */
    predicate: string;
    /**
     * Object entity ID
     */
    object: string;
  }[];
}
