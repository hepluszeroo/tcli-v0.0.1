#!/usr/bin/env node

const { compileFromFile } = require('json-schema-to-typescript');
const fs = require('fs');
const path = require('path');

const SCHEMAS_DIR = path.join(__dirname, '../src/schemas');
const TYPES_DIR = path.join(__dirname, '../src/types');

// Ensure types directory exists
if (!fs.existsSync(TYPES_DIR)) {
  fs.mkdirSync(TYPES_DIR, { recursive: true });
}

// Get list of schema files
const schemaFiles = fs.readdirSync(SCHEMAS_DIR)
  .filter(file => file.endsWith('.schema.json'));

// Process each schema file
async function generateTypes() {
  for (const schemaFile of schemaFiles) {
    const schemaPath = path.join(SCHEMAS_DIR, schemaFile);
    const typeName = schemaFile.replace('.schema.json', '');
    const outputPath = path.join(TYPES_DIR, `${typeName}.ts`);
    
    try {
      console.log(`Generating types for ${schemaFile}...`);
      const ts = await compileFromFile(schemaPath, {
        bannerComment: '/* Generated from JSON schema - do not edit manually */',
        additionalProperties: false,
      });
      
      fs.writeFileSync(outputPath, ts);
      console.log(`  ✓ Written to ${outputPath}`);
    } catch (error) {
      console.error(`  ✗ Error processing ${schemaFile}:`, error);
      process.exit(1);
    }
  }
  
  // Create index.ts file to export all types
  const indexContent = schemaFiles
    .map(file => {
      const typeName = file.replace('.schema.json', '');
      return `export * from './${typeName}';`;
    })
    .join('\n') + '\n';
  
  fs.writeFileSync(path.join(TYPES_DIR, 'index.ts'), indexContent);
  console.log('  ✓ Generated types index file');
}

generateTypes().catch(error => {
  console.error('Failed to generate types:', error);
  process.exit(1);
});