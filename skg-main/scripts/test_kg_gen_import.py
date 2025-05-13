#!/usr/bin/env python3
"""Test KGGen import and usage"""

try:
    from kg_gen.kg_gen import KGGen
    print("Successfully imported KGGen module")
    
    # Try creating an instance
    kg_gen = KGGen()
    print("Successfully created KGGen instance")
    
    # Print available methods
    methods = [method for method in dir(kg_gen) if not method.startswith('_')]
    print(f"Available methods: {methods}")
    
except Exception as e:
    print(f"Error importing or using KGGen: {e}")