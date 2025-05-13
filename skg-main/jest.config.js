/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  // Run unit tests located in tests/utils as well as new graph-store and other unit test suites
  // Skip integration tests by default which are tagged with @slow
  testMatch: ['**/tests/(utils|graph-store|fragment-store)/**/*.test.ts'],
  testPathIgnorePatterns: [
    '/node_modules/',
    '/dist/',
    '@slow' // Skip slow integration tests by default
  ],
  collectCoverage: false,  // Only collect coverage when explicitly requested
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/types/**/*.ts',
  ],
  moduleNameMapper: {
    // Handle TypeScript path aliases
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      isolatedModules: true
    }]
  },
  setupFilesAfterEnv: ['<rootDir>/tests/setupTests.ts'],
};