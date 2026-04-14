module.exports = {
  extends: 'expo',
  root: true,
  rules: {
    // react-hooks/exhaustive-deps: all omissions are intentional (Zustand setters and
    // router refs are stable references that must not be in deps to avoid re-subscriptions)
    'react-hooks/exhaustive-deps': 'off',
    // Allow _prefixed destructured vars (intentional ignores)
    '@typescript-eslint/no-unused-vars': ['warn', {
      argsIgnorePattern: '^_',
      varsIgnorePattern: '^_',
      caughtErrorsIgnorePattern: '^_',
    }],
  },
  overrides: [
    {
      // jest.mock() must precede imports (hoisting requirement — see CLAUDE.md anti-pattern #2)
      files: ['**/__tests__/**/*.{ts,tsx}', '**/*.test.{ts,tsx}', '**/*.spec.{ts,tsx}'],
      rules: {
        'import/first': 'off',
      },
    },
  ],
};
