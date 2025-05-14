/**
 * Test script for sending SIGHUP to a running SKB worker
 * 
 * Usage: node test-sighup.js <pid>
 */

const pid = process.argv[2];

if (!pid) {
  console.error('Please provide a process ID');
  process.exit(1);
}

try {
  console.log(`Sending SIGHUP to process ${pid}`);
  process.kill(pid, 'SIGHUP');
  console.log('SIGHUP sent successfully');
} catch (error) {
  console.error(`Error sending SIGHUP: ${error.message}`);
  process.exit(1);
}