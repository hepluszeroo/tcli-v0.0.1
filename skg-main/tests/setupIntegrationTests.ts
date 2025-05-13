/**
 * Integration test setup
 */

// Increase timeout for all tests
jest.setTimeout(30000);

// Log test environment info
console.log('Integration test environment:');
console.log(`BROKER_URL: ${process.env.BROKER_URL || 'nats://localhost:4222'}`);
console.log(`NODE_ENV: ${process.env.NODE_ENV || 'test'}`);