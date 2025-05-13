#!/usr/bin/env python3
"""
KGGen CLI wrapper

This script provides a command-line interface to the KGGen library.
It reads input text from a file, generates a knowledge graph, and
saves it to an output file.

Usage:
  python kg_gen_cli.py --input <input_file> --output <output_file> [--model <model_name>]
"""

import argparse
import json
import os
import sys
import time

# Import KGGen
try:
    from kg_gen.kg_gen import KGGen
except ImportError:
    print("Error: KGGen module not found. Make sure it's installed.")
    sys.exit(1)

def main():
    # Parse command line arguments
    parser = argparse.ArgumentParser(description="Generate knowledge graph from text")
    parser.add_argument("--input", required=True, help="Path to input text file")
    parser.add_argument("--output", required=True, help="Path to output JSON file")
    parser.add_argument("--model", default="openai/gpt-4", help="Model to use (default: openai/gpt-4)")
    args = parser.parse_args()

    # Check if input file exists
    if not os.path.exists(args.input):
        print(f"Error: Input file '{args.input}' not found")
        sys.exit(1)

    # Read input text
    try:
        with open(args.input, 'r', encoding='utf-8') as f:
            text = f.read()
    except Exception as e:
        print(f"Error reading input file: {e}")
        sys.exit(1)
    
    # Check for API key
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        print("Error: OPENAI_API_KEY environment variable not set")
        sys.exit(1)
    
    # Initialize KGGen
    try:
        kg_gen = KGGen(model=args.model, api_key=api_key)
    except Exception as e:
        print(f"Error initializing KGGen: {e}")
        sys.exit(1)
    
    # Generate knowledge graph
    try:
        # Measure execution time
        start_time = time.time()
        graph = kg_gen.generate(text)
        end_time = time.time()
        duration = end_time - start_time
        
        # Convert to the expected format
        result = {
            "note_id": os.path.basename(args.input).split('.')[0],  # Use filename as note_id
            "entities": [{"id": e.id, "label": e.label, "type": e.type or "Concept"} for e in graph.entities],
            "relations": [r for r in graph.relations],
            "triples": [{"subject": t.subject, "predicate": t.predicate, "object": t.object} for t in graph.triples]
        }
        
        # Write output
        with open(args.output, 'w', encoding='utf-8') as f:
            json.dump(result, f, indent=2)
        
        print(f"Knowledge graph generated successfully in {duration:.2f} seconds")
        print(f"Entities: {len(result['entities'])}")
        print(f"Relations: {len(result['relations'])}")
        print(f"Triples: {len(result['triples'])}")
        print(f"Output saved to {args.output}")
        
    except Exception as e:
        print(f"Error generating knowledge graph: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()