// jest.config.js
export default {
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  testMatch: [
    '**/__tests__/**/*.ts',  // Matches test files in __tests__ directories
    '**/?(*.)+(spec|test).[jt]s?(x)',  // Matches files with .test.ts or .spec.ts
  ],
  roots: ['<rootDir>/src', '<rootDir>/tests'],
  transform: {
      '^.+\\.tsx?$': 'ts-jest'
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  collectCoverage: true,
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov'],
  coverageThreshold: {
      global: {
          branches: 80,
          functions: 80,
          lines: 80,
          statements: 80
      }
  },
  verbose: true,
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js']
};
