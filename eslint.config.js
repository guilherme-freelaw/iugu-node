// ESLint v9 flat config
// Flat config sem plugins para evitar incompatibilidades com ESLint v9

module.exports = [
  {
    ignores: [
      'node_modules/**',
      'out/**',
      'logs/**',
      'tmp/**',
      'supabase/migrations/**',
      'docs/reports/**',
    ],
  },
  {
    files: ['lib/**/*.js', 'scripts/**/*.js', 'test/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        require: 'readonly',
        module: 'readonly',
        __dirname: 'readonly',
        process: 'readonly',
        describe: 'readonly',
        it: 'readonly',
        before: 'readonly',
        after: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
      },
    },
    plugins: {},
    rules: {
      // Regras conservadoras
      eqeqeq: ['warn', 'smart'],

      // Evitar refactors automáticos arriscados
      'no-var': 'off',
      'prefer-const': 'off',
      'no-useless-escape': 'off',
    },
  },
];
