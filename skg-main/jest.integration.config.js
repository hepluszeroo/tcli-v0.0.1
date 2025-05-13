/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests/'],
  testMatch: ['**/tests/integration/**/*.ts'],
  testTimeout: 30000, // 30 seconds timeout for integration tests
  setupFilesAfterEnv: ['<rootDir>/tests/setupIntegrationTests.ts'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      isolatedModules: true,
    }],
  },
};