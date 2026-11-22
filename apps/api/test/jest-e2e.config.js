/** Integration / e2e tests against a real PostgreSQL database (DATABASE_URL_TEST). */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '..',
  testRegex: '.*\\.e2e-spec\\.ts$',
  globalSetup: '<rootDir>/test/global-setup.ts',
  setupFiles: ['<rootDir>/test/setup-env.ts'],
  testTimeout: 120000,
};
