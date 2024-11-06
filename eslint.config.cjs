// eslint.config.cjs
const typescriptPlugin = require('@typescript-eslint/eslint-plugin');
const typescriptParser = require('@typescript-eslint/parser');

module.exports = [
  {
    files: ['**/*.ts'],  // Only target TypeScript files
    languageOptions: {
      parser: typescriptParser,
      ecmaVersion: 2018,
      sourceType: 'module',
      globals: { browser: true,
        es6: true,
        node: true,
      }
    },
    plugins: {
      '@typescript-eslint': typescriptPlugin,
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-console': 'warn',
    },
  },
];
