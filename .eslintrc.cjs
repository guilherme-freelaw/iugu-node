module.exports = {
  root: true,
  env: { node: true, es2022: true, mocha: true },
  parserOptions: { ecmaVersion: 2022, sourceType: 'script' },
  plugins: ['node'],
  extends: ['eslint:recommended', 'plugin:node/recommended', 'prettier'],
  rules: {
    // Segurança/robustez sem mudanças de comportamento
    'node/no-deprecated-api': 'warn',
    eqeqeq: ['warn', 'smart'],

    // Evitar refactors automáticos arriscados
    'no-var': 'off',
    'prefer-const': 'off',
    'no-useless-escape': 'off'
  },
  ignorePatterns: [
    'node_modules/',
    'out/',
    'logs/',
    'tmp/',
    'supabase/migrations/',
    'docs/reports/'
  ],
};

