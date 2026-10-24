module.exports = {
  projects: [
    {
      displayName: 'Native',
      preset: 'jest-expo',
      testMatch: ['**/__tests__/**/*.test.ts?(x)'],
      testPathIgnorePatterns: ['/node_modules/', '\\.web\\.test\\.'],
      clearMocks: true,
    },
    {
      displayName: 'Web',
      preset: 'jest-expo/web',
      testMatch: ['**/__tests__/**/*.web.test.ts?(x)'],
      clearMocks: true,
    },
  ],
  testTimeout: 15000,
};
