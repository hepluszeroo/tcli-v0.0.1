#!/usr/bin/env python3
"""
Direct KGGen test script

This script tests the KGGen Python library directly, bypassing the CLI:
1. Creates a sample text
2. Calls KGGen to generate a knowledge graph
3. Saves the result to a JSON file
4. Displays the entities, relations, and triples

Usage:
  OPENAI_API_KEY=your-openai-key python3 scripts/direct_kggen_test.py
"""

import os
import json
import uuid
from pathlib import Path

# Import KGGen directly
try:
    from kg_gen.kg_gen import KGGen
except ImportError:
    print("ERROR: KGGen module not found. Make sure it's installed:")
    print("  pip install kg-gen==0.4.3")
    exit(1)

# Sample test note content
TEST_NOTE = """
# Neural Networks and Deep Learning

Neural networks are computational models inspired by the human brain. They consist of layers of interconnected nodes or "neurons" that can learn patterns from data.

## Key Components

1. Input Layer: Receives initial data
2. Hidden Layers: Process information using weights and activation functions
3. Output Layer: Produces the final prediction or classification

Deep learning refers to neural networks with multiple hidden layers that can learn hierarchical representations.

## Common Architectures

- Convolutional Neural Networks (CNNs): Used for image processing
- Recurrent Neural Networks (RNNs): Handle sequential data like text
- Transformers: State-of-the-art models for natural language processing

The backpropagation algorithm allows networks to learn by updating weights based on prediction errors.
"""

def main():
    # Check API key
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        print("Error: OPENAI_API_KEY environment variable not set")
        exit(1)
    
    print("========== DIRECT KGGEN TEST ==========")
    print(f"Using model: {os.environ.get('KGGEN_MODEL', 'openai/gpt-4')}")
    
    # Create fragment directory
    fragment_dir = os.environ.get("FRAGMENT_DIR", "./test-fragments")
    Path(fragment_dir).mkdir(exist_ok=True)
    
    # Generate unique note ID
    note_id = str(uuid.uuid4())
    
    # Initialize KGGen
    model_name = os.environ.get("KGGEN_MODEL", "openai/gpt-4")
    kg_gen = KGGen(model=model_name, api_key=api_key)
    
    print(f"\nGenerating knowledge graph for test note (ID: {note_id})...")
    print("This may take a minute or two depending on the model...\n")
    
    # Generate knowledge graph
    start_time = __import__("time").time()
    graph = kg_gen.generate(TEST_NOTE)
    end_time = __import__("time").time()
    duration_ms = int((end_time - start_time) * 1000)
    
    # Convert to our format
    fragment = {
        "note_id": note_id,
        "entities": [{"id": e.id, "label": e.label, "type": e.type or "Concept"} for e in graph.entities],
        "relations": [r for r in graph.relations],
        "triples": [{"subject": t.subject, "predicate": t.predicate, "object": t.object} for t in graph.triples]
    }
    
    # Save to file
    output_path = Path(fragment_dir) / f"{note_id}.json"
    with open(output_path, "w") as f:
        json.dump(fragment, f, indent=2)
    
    # Display results
    print(f"✓ Knowledge graph generated successfully in {duration_ms}ms!")
    print("\nFragment contents:")
    print(json.dumps(fragment, indent=2))
    
    # Output stats
    print("\nStats:")
    print(f"- Entities: {len(fragment['entities'])}")
    print(f"- Relations: {len(fragment['relations'])}")
    print(f"- Triples: {len(fragment['triples'])}")
    print(f"\n✓ Fragment file saved to: {output_path}")
    
    print("\n============================================")
    print("          TEST COMPLETED SUCCESSFULLY        ")
    print("============================================")

if __name__ == "__main__":
    main()