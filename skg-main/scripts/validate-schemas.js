#!/usr/bin/env node

const Ajv = require('ajv');
const addFormats = require('ajv-formats');
const fs = require('fs');
const path = require('path');

const SCHEMAS_DIR = path.join(__dirname, '../src/schemas');

// Create and configure Ajv instance
const ajv = new Ajv({
  allErrors: true
});

// Add formats like 'date-time', 'uuid', etc.
addFormats(ajv);

// Get all schema files
const schemaFiles = fs.readdirSync(SCHEMAS_DIR)
  .filter(file => file.endsWith('.schema.json'));

let hasError = false;

// Validate each schema
for (const schemaFile of schemaFiles) {
  const schemaPath = path.join(SCHEMAS_DIR, schemaFile);
  try {
    console.log(`Validating ${schemaFile}...`);
    const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
    
    // Validating schema
    ajv.compile(schema);
    console.log(`  ✓ Schema is valid`);
  } catch (error) {
    console.error(`  ✗ Error validating ${schemaFile}: ${error.message}`);
    hasError = true;
  }
}

if (hasError) {
  process.exit(1);
}