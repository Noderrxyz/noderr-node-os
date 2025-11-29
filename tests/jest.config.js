module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/migrated'],
  testMatch: ['**/*.test.ts', '**/*.spec.ts'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  collectCoverageFrom: [
    '../packages/**/*.ts',
    '!../packages/**/*.d.ts',
    '!../packages/**/node_modules/**'
  ],
  coverageDirectory: './coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  moduleNameMapper: {
    '^@noderr/(.*)$': '<rootDir>/../packages/$1/src'
  },
  setupFilesAfterEnv: ['<rootDir>/setup.ts'],
  testTimeout: 30000,
  maxWorkers: '50%'
};
