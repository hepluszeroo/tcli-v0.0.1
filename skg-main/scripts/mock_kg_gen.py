#!/usr/bin/env python3
"""
Mock KGGen CLI for demo purposes
Reads text from an input file and generates a mock knowledge graph fragment
"""
import json
import os
import sys
import argparse
import time
import re
from uuid import uuid4

def extract_entities(text):
    """Extract named entities from text in a very simple way"""
    # This is an extremely simplified simulation of entity extraction
    # In reality, this would use a more sophisticated NLP approach
    words = re.findall(r'\b[A-Z][a-z]+\b', text)
    entities = []
    entity_map = {}
    
    for i, word in enumerate(set(words)):
        entity_id = f"e{i+1}"
        entity_map[word] = entity_id
        
        # Assign a type based on simple heuristics
        entity_type = "Concept"
        if word in ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]:
            entity_type = "Day"
        elif word in ["January", "February", "March", "April", "May", "June", "July", 
                     "August", "September", "October", "November", "December"]:
            entity_type = "Month"
        elif word in ["Paris", "London", "Berlin", "Rome", "Madrid", "Vienna", "Amsterdam"]:
            entity_type = "City"
        elif word in ["France", "Germany", "Italy", "Spain", "Netherlands", "Austria", "UK", "United"]:
            entity_type = "Country"
        
        entities.append({
            "id": entity_id,
            "label": word,
            "type": entity_type
        })
    
    return entities, entity_map

def extract_relations(entities, entity_map):
    """Create mock relations between entities"""
    if len(entities) < 2:
        return [], []
    
    # Just create some basic relation types
    relation_types = ["relates_to", "part_of", "associated_with", "belongs_to"]
    
    # Select relation types to use (minimum 1)
    if len(entities) == 2:
        selected_relations = relation_types[:1]
    else:
        selected_relations = relation_types[:min(len(entities)-1, len(relation_types))]
    
    # Create triples
    triples = []
    for i in range(min(len(entities)-1, 5)):  # Create at most 5 triples
        subject_entity = entities[i]
        object_entity = entities[(i+1) % len(entities)]
        relation = selected_relations[i % len(selected_relations)]
        
        triples.append({
            "subject": subject_entity["id"],
            "predicate": relation,
            "object": object_entity["id"]
        })
    
    return selected_relations, triples

def main():
    # Parse command line arguments
    parser = argparse.ArgumentParser(description='Mock KGGen CLI')
    parser.add_argument('--input', type=str, required=True, help='Input text file')
    parser.add_argument('--output', type=str, required=True, help='Output JSON file')
    parser.add_argument('--model', type=str, default='openai/gpt-4', help='Model to use')
    args = parser.parse_args()
    
    # Simulate processing time
    time.sleep(0.5)
    
    # Read input text
    try:
        with open(args.input, 'r') as f:
            text = f.read()
    except Exception as e:
        sys.stderr.write(f"Error reading input file: {e}\n")
        sys.exit(1)
    
    # Extract entities and relations
    entities, entity_map = extract_entities(text)
    relations, triples = extract_relations(entities, entity_map)
    
    # Create the fragment
    note_id = os.path.basename(args.input).split('-')[0]
    fragment = {
        "note_id": note_id,
        "entities": entities,
        "relations": relations,
        "triples": triples
    }
    
    # Write output
    try:
        os.makedirs(os.path.dirname(args.output), exist_ok=True)
        with open(args.output, 'w') as f:
            json.dump(fragment, f, indent=2)
        sys.stdout.write(f"Successfully generated KG fragment: {args.output}\n")
        
    except Exception as e:
        sys.stderr.write(f"Error writing output file: {e}\n")
        sys.exit(1)
    
    sys.exit(0)

if __name__ == "__main__":
    main()