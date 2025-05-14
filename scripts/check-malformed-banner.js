#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

// Path to main.js bundle in Docker
const mainJsPath = process.argv[2] || '/repo/Tangent-main/apps/tangent-electron/__build/bundle/main.js';

try {
  console.log(`Checking for malformed banner in: ${mainJsPath}`);
  
  if (!fs.existsSync(mainJsPath)) {
    console.error(`ERROR: File ${mainJsPath} does not exist!`);
    process.exit(1);
  }
  
  // Read the file
  const content = fs.readFileSync(mainJsPath, 'utf8');
  
  // Look for malformed strings (missing closing quote)
  const lines = content.split('\n');
  
  let malformedLineIndex = -1;
  const malformedPatterns = [
    "process.stderr.write('Debugger listening on",
    "process.stderr.write('DevTools listening on",
    "console.error('Debugger listening on",
    "console.error('DevTools listening on"
  ];
  
  // Check each line
  let lineNumber = 0;
  const malformedLines = [];
  
  lines.forEach((line, index) => {
    lineNumber = index + 1;
    
    // Check if the line contains a potentially malformed string
    malformedPatterns.forEach(pattern => {
      if (line.includes(pattern)) {
        // Check if the line has a proper closing quote and ends with ');'
        const hasClosingQuote = line.includes("');") || line.includes("\\n');");
        if (!hasClosingQuote) {
          malformedLines.push({
            lineNumber,
            content: line,
            pattern
          });
        }
      }
    });
  });
  
  if (malformedLines.length > 0) {
    console.log(`\n=== FOUND ${malformedLines.length} POTENTIALLY MALFORMED LINES ===`);
    
    malformedLines.forEach(({ lineNumber, content, pattern }) => {
      console.log(`\nLine ${lineNumber}:`);
      console.log(content);
      console.log('Expected pattern:', pattern + "...\\n');");
      
      // Show context (5 lines before and after)
      console.log('\nContext:');
      const startLine = Math.max(0, lineNumber - 5);
      const endLine = Math.min(lines.length, lineNumber + 5);
      
      for (let i = startLine; i < endLine; i++) {
        const prefix = i + 1 === lineNumber ? '> ' : '  ';
        console.log(`${prefix}${i + 1}: ${lines[i]}`);
      }
    });
  } else {
    console.log('No malformed banner strings found in the file.');
    
    // Also check for synthetic_forced occurrences
    const syntheticCount = (content.match(/synthetic_forced/g) || []).length;
    console.log(`Found ${syntheticCount} references to "synthetic_forced" in the file.`);
  }
  
} catch (error) {
  console.error('Error checking file:', error);
  process.exit(1);
}