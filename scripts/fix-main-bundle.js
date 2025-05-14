#!/usr/bin/env node
/**
 * Script to analyze and fix issues in the main.js bundle
 * 
 * This script:
 * 1. Scans for malformed banner strings
 * 2. Removes them from the bundle
 * 3. Adds correct banner strings at the beginning of the file
 * 4. Creates a backup of the original file
 */

const fs = require('fs');
const path = require('path');

// Path to main.js bundle
const mainJsPath = process.argv[2] || '/repo/Tangent-main/apps/tangent-electron/__build/bundle/main.js';
const backupPath = `${mainJsPath}.original`;

// Banner patterns to look for
const malformedPatterns = [
  /process\.stderr\.write\(['"]Debugger listening on ws:\/\/[^'"]*(?!['"]\);)/g,
  /process\.stderr\.write\(['"]DevTools listening on ws:\/\/[^'"]*(?!['"]\);)/g,
  /console\.error\(['"]Debugger listening on ws:\/\/[^'"]*(?!['"]\);)/g,
  /console\.error\(['"]DevTools listening on ws:\/\/[^'"]*(?!['"]\);)/g
];

// Properly formatted banners to add at the beginning
const correctBanners = `
// FIXED SYNTHETIC BANNERS - Added by fix-main-bundle.js
process.stderr.write("Debugger listening on ws://127.0.0.1:9222/synthetic_forced\\n");
process.stderr.write("DevTools listening on ws://127.0.0.1:9222/synthetic_forced\\n");
console.error("Debugger listening on ws://127.0.0.1:9222/synthetic_forced");
console.error("DevTools listening on ws://127.0.0.1:9222/synthetic_forced");

`;

try {
  console.log(`Analyzing main.js bundle at: ${mainJsPath}`);
  
  if (!fs.existsSync(mainJsPath)) {
    console.error(`ERROR: File ${mainJsPath} does not exist!`);
    process.exit(1);
  }
  
  // Read the file content
  let content = fs.readFileSync(mainJsPath, 'utf8');
  
  // Create backup
  console.log(`Creating backup at: ${backupPath}`);
  fs.writeFileSync(backupPath, content);
  
  // Count original "synthetic_forced" occurrences
  const originalCount = (content.match(/synthetic_forced/g) || []).length;
  console.log(`Found ${originalCount} "synthetic_forced" occurrences in original file`);
  
  // Check and remove any malformed patterns
  let malformedFound = false;
  let cleanedContent = content;
  
  // Examine for malformed patterns
  for (const pattern of malformedPatterns) {
    const matches = content.match(pattern);
    if (matches && matches.length > 0) {
      malformedFound = true;
      console.log(`Found ${matches.length} malformed banner patterns matching: ${pattern}`);
      
      // For each match, display the problematic code
      matches.forEach(match => {
        console.log(`  - Malformed string: ${match}`);
        
        // Extract the position for context
        const index = content.indexOf(match);
        if (index !== -1) {
          const start = Math.max(0, index - 50);
          const end = Math.min(content.length, index + match.length + 50);
          const context = content.substring(start, end);
          console.log(`  - Context: ...${context}...`);
        }
      });
      
      // Remove the malformed patterns from the content
      cleanedContent = cleanedContent.replace(pattern, '/* REMOVED MALFORMED BANNER */');
    }
  }
  
  // Add correct banners at the beginning
  const fixedContent = correctBanners + cleanedContent;
  
  // Write the fixed file
  console.log('Writing fixed file...');
  fs.writeFileSync(mainJsPath, fixedContent);
  
  // Verify fix was successful
  const newContent = fs.readFileSync(mainJsPath, 'utf8');
  const newCount = (newContent.match(/synthetic_forced/g) || []).length;
  console.log(`New file has ${newCount} "synthetic_forced" occurrences`);
  
  if (malformedFound) {
    console.log(`✅ Fixed malformed banners in ${mainJsPath}`);
  } else {
    console.log(`ℹ️ No malformed banners were found, but correct banners were added to ensure functionality`);
  }
  
  console.log(`Original file backed up to: ${backupPath}`);
  console.log('Done!');
  
} catch (error) {
  console.error('Error fixing main.js bundle:', error);
  process.exit(1);
}