// Test setup for migrated tests

// Extend timeout for integration tests
jest.setTimeout(30000);

// Mock environment variables
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error';

// Global test utilities
global.beforeAll(() => {
  console.log('Starting test suite...');
});

global.afterAll(() => {
  console.log('Test suite completed.');
});
